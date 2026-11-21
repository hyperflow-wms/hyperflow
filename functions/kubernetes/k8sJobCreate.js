// k8sJobCreate.js
// Creates a task's Kubernetes Job, retrying transient API errors, and fails
// the Job's tasks when the Job cannot be created.
//
// The caller passes in the API client (a BatchV1Api of
// '@kubernetes/client-node' 0.12), so this module requires no npm package and
// tests can load it directly.

const clog = require('../../common/consoleLogger');

// Number of retries after the first attempt, unless HF_VAR_JOB_CREATE_RETRIES
// sets another value.
const DEFAULT_RETRIES = 10;
// The delay before retry n is drawn at random between half and all of
// min(BASE_DELAY_MS * 2^(n-1), MAX_DELAY_MS).
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
// Exit code with which the tasks of a Job that cannot be created fail.
const JOB_CREATE_FAILED_EXIT_CODE = 1;

let warnedInvalidRetries = false;

// Reads the retry limit from HF_VAR_JOB_CREATE_RETRIES (a non-negative
// integer; 0 disables retries).
function retriesFromEnv(env) {
  let raw = env.HF_VAR_JOB_CREATE_RETRIES;
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_RETRIES;
  }
  raw = String(raw).trim();
  if (!/^\d+$/.test(raw)) {
    if (!warnedInvalidRetries) {
      warnedInvalidRetries = true;
      clog.warn("Invalid HF_VAR_JOB_CREATE_RETRIES='" + raw + "', using the default of " +
                DEFAULT_RETRIES + " retries");
    }
    return DEFAULT_RETRIES;
  }
  return parseInt(raw, 10);
}

// HTTP status code of a failed API call, or undefined when no HTTP response
// arrived (connection error, timeout).
function errorStatusCode(err) {
  if (err && err.response && typeof err.response.statusCode === 'number') {
    return err.response.statusCode;
  }
  if (err && typeof err.statusCode === 'number') {
    return err.statusCode;
  }
  return undefined;
}

// The Kubernetes Status object of a failed API call, or {} when there is
// none. client-node 0.12 parses an error's body as the call's return type
// (V1Job), which drops the Status fields 'reason' and 'details' from
// 'err.body'; 'err.response.body' keeps the body as the API server sent it.
function errorStatus(err) {
  if (!err) {
    return {};
  }
  let candidates = [err.response && err.response.body, err.body];
  for (let body of candidates) {
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        continue;
      }
    }
    if (body && typeof body === 'object' && (body.kind === 'Status' || body.reason !== undefined)) {
      return body;
    }
  }
  return {};
}

// Delay in ms requested by the Retry-After header of a failed API call, or
// undefined when the header is absent or unreadable. The header holds either
// a number of seconds or an HTTP date.
function retryAfterMs(err) {
  let headers = err && err.response && err.response.headers;
  let value = headers && headers['retry-after'];
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  let seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  let date = Date.parse(value);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

// Decides what a failed create call means:
// - 'created': 409 AlreadyExists for this Job's name, so an earlier attempt
//   reached the API server although its response was lost;
// - 'retry': a transient error (no HTTP response, 409 other than
//   AlreadyExists such as a resource quota conflict, 429, or 5xx);
// - 'fail': any other error, such as 400, 403, 404 or 422, or AlreadyExists
//   for another name.
function classifyCreateError(err, jobName) {
  let statusCode = errorStatusCode(err);
  if (statusCode === undefined) {
    return 'retry';
  }
  if (statusCode === 409) {
    let status = errorStatus(err);
    if (status.reason === 'AlreadyExists') {
      let name = status.details && status.details.name;
      return (jobName !== undefined && name === jobName) ? 'created' : 'fail';
    }
    return 'retry';
  }
  if (statusCode === 429 || statusCode >= 500) {
    return 'retry';
  }
  return 'fail';
}

// Delay in ms before retry number 'retry' (1 for the first retry):
// exponential backoff with jitter, at least the Retry-After delay when the
// API server sent one, and never more than MAX_DELAY_MS.
function retryDelayMs(retry, err, random) {
  let backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, retry - 1));
  let delay = backoff * (0.5 + 0.5 * random());
  let retryAfter = retryAfterMs(err);
  if (retryAfter !== undefined) {
    delay = Math.max(delay, retryAfter);
  }
  return Math.round(Math.min(MAX_DELAY_MS, delay));
}

function describeError(err) {
  let statusCode = errorStatusCode(err);
  if (statusCode !== undefined) {
    let status = errorStatus(err);
    let text = 'HTTP ' + statusCode;
    if (status.reason) text += ' ' + status.reason;
    if (status.message) text += ': ' + status.message;
    return text;
  }
  if (err && err.code) {
    return err.code + (err.message ? ': ' + err.message : '');
  }
  return String((err && err.message) || err);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function createJobWithRetries
// Creates the Job, retrying transient errors with exponential backoff.
//
// Inputs:
// - 'k8sApi': object with a 'createNamespacedJob(namespace, body)' method
//   returning a promise (a BatchV1Api of client-node 0.12)
// - 'namespace', 'jobYaml': the Job's namespace and parsed definition
// - 'taskIds': ids of the tasks the Job runs, for logging
// - 'options' (optional): 'retries' overrides HF_VAR_JOB_CREATE_RETRIES,
//   'sleep(ms)' and 'random()' replace the timer and Math.random (for tests)
//
// Returns a promise that never rejects and resolves to
// { created, attempts, error, statusCode }.
async function createJobWithRetries(k8sApi, namespace, jobYaml, taskIds, options) {
  options = options || {};
  let retries = options.retries !== undefined ? options.retries : retriesFromEnv(process.env);
  let sleep = options.sleep || defaultSleep;
  let random = options.random || Math.random;
  let jobName = jobYaml && jobYaml.metadata ? jobYaml.metadata.name : undefined;
  let tasks = [].concat(taskIds).join(', ');
  let maxAttempts = retries + 1;

  for (let attempt = 1; ; attempt++) {
    let err;
    try {
      await k8sApi.createNamespacedJob(namespace, jobYaml);
      return { created: true, attempts: attempt };
    } catch (e) {
      err = e;
    }

    let statusCode = errorStatusCode(err);
    let outcome = classifyCreateError(err, jobName);
    if (outcome === 'created') {
      clog.warn("Create k8s job " + jobName + " for tasks [" + tasks + "]: attempt " + attempt +
                " got " + describeError(err) + "; the Job exists, counting it as created");
      return { created: true, attempts: attempt };
    }
    if (outcome === 'retry' && attempt < maxAttempts) {
      let delay = retryDelayMs(attempt, err, random);
      clog.warn("Create k8s job " + jobName + " for tasks [" + tasks + "] failed (attempt " +
                attempt + " of " + maxAttempts + ", status " +
                (statusCode !== undefined ? statusCode : 'none') + ", " + describeError(err) +
                "), retrying in " + delay + "ms");
      await sleep(delay);
      continue;
    }

    clog.error("Create k8s job " + jobName + " for tasks [" + tasks + "] failed for good after " +
               attempt + " attempt" + (attempt === 1 ? "" : "s") + " (" +
               (outcome === 'retry' ? "retry limit reached" : "error not retried") + "): " +
               describeError(err) + "; the tasks fail with exit code " + JOB_CREATE_FAILED_EXIT_CODE);
    clog.debug("Job YAML:", JSON.stringify(jobYaml));
    return { created: false, attempts: attempt, error: err, statusCode: statusCode };
  }
}

// Ends the wait of each task with JOB_CREATE_FAILED_EXIT_CODE, as if its job
// had exited with that code. Never throws.
function failTasks(taskIdArr, contextArr) {
  for (let i = 0; i < taskIdArr.length; i++) {
    try {
      contextArr[i].resolveJobResult(JOB_CREATE_FAILED_EXIT_CODE, taskIdArr[i]);
    } catch (err) {
      clog.error("Unable to fail task", taskIdArr[i], "after its k8s job creation failed:", err);
    }
  }
}

// Function startJobCreation
// Starts creating the Job in the background and returns at once, so the
// caller can send the job messages in parallel. If the Job cannot be
// created, every task in 'taskIdArr' fails: its 'context.jobResult' wait
// ends with JOB_CREATE_FAILED_EXIT_CODE, whether that wait has started yet
// or not, and the code that handles a failed job takes over.
//
// Inputs: see 'createJobWithRetries'; 'contextArr' holds the tasks' contexts.
//
// Returns the promise of 'createJobWithRetries', which never rejects; callers
// need not await it.
function startJobCreation(k8sApi, namespace, jobYaml, taskIdArr, contextArr, options) {
  return createJobWithRetries(k8sApi, namespace, jobYaml, taskIdArr, options)
    .catch((err) => {
      clog.error("Create k8s job for tasks [" + [].concat(taskIdArr).join(', ') + "] failed unexpectedly:", err);
      return { created: false, error: err };
    })
    .then((result) => {
      if (!result.created) {
        failTasks(taskIdArr, contextArr);
      }
      return result;
    });
}

exports.startJobCreation = startJobCreation;
exports.createJobWithRetries = createJobWithRetries;
exports.classifyCreateError = classifyCreateError;
exports.retryDelayMs = retryDelayMs;
exports.retriesFromEnv = retriesFromEnv;
exports.DEFAULT_RETRIES = DEFAULT_RETRIES;
exports.MAX_DELAY_MS = MAX_DELAY_MS;
exports.JOB_CREATE_FAILED_EXIT_CODE = JOB_CREATE_FAILED_EXIT_CODE;

const k8s = require('@kubernetes/client-node');
var fs = require('fs');
const yaml = require('js-yaml');

// k8sJobSubmit.js
// Common functions for job submission to Kubernetes clusters

// Function createK8sJobMessage - creates the job message
//
// Inputs:
// - 'job': job definition object; it should contain:
//   * 'executable' and 'args' (usually passed via 'context.executor')
//   * 'ins' and 'outs' (arrays, as passed to the process function)
//   * 'name': job class name (not unique id), usually passed via 'context.name'
// - 'taskId': unique task identifier (use 'context.taskId' or define custom)
// - 'context': pass the 'context' parameter of the process function;
//    it should contain the 'redis_url'
//
// Returns:
// - jobMessage: string with job command to be sent to a remote executor
function createK8sJobMessage(job, taskId, context) {
  let jobMessage = {
    "executable": job.executable,
    "args": [].concat(job.args),
    // "env": job.env || {},
    "inputs": job.ins.map(i => i),
    "outputs": job.outs.map(o => o),
    "stdout": job.stdout, // if present, denotes file name to which stdout should be redirected
    "stderr": job.stderr, // if present, denotes file name to which stderr should be redirected
    "stdoutAppend": job.stdoutAppend, // redirect stdout in append mode
    "stderrAppend": job.stderrAppend, // redirect stderr in append mode
    "redis_url": context.redis_url,
    "taskId": taskId,
    "name": job.name
  }
  return jobMessage;
}

// Function createK8sJobYaml
//
// Inputs:
// - 'job': job definition object; it should contain:
//   * 'name': job class name (not unique id), usually passed via 'context.name'
// - 'taskIds': array of unique tasks' identifiers (use '[context.taskId]' or define custom)
// - 'context': pass the 'context' parameter of the process function;
//    it should contain the 'redis_url', 'hfId', 'appId'
// - 'jobYamlTemplate': job YAML that may contain variables '{{varname}}'
// - 'customParams': JSON object that defines values for variables in the
//   job's YAML template.
//
// Returns:
// - jobYaml: string with job YAML to create the k8s job
var createK8sJobYaml = (job, taskIds, context, jobYamlTemplate, customParams) => {
  let quotedTaskIds = taskIds.map(x => '"' + x + '"');
  var command = 'hflow-job-execute ' + context.redis_url + ' -a -- ' + quotedTaskIds.join(' ');
  var containerName = job.image || process.env.HF_VAR_WORKER_CONTAINER;
  var volumePath = '/work_dir';
  var jobName = Math.random().toString(36).substring(7) + '-' +
                job.name.replace(/_/g, '-') + "-" + context.procId + '-' + context.firingId;

  // remove chars not allowd in Pod names
  jobName = jobName.replace(/[^0-9a-z-]/gi, '').toLowerCase();

  var cpuRequest = job.cpuRequest || process.env.HF_VAR_CPU_REQUEST || "0.5";
  var memRequest = job.memRequest || process.env.HF_VAR_MEM_REQUEST || "50Mi";

  // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
  var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0;
  var restartPolicy = backoffLimit > 0 ? "OnFailure": "Never";

  var restartCount = 0;

  // use string replacement (instead of eval) to evaluate job template
  // 'params' should contain values for variables to be replaced in job template yaml
  var params = {
    command: command, containerName: containerName,
    jobName: jobName, volumePath: volumePath,
    cpuRequest: cpuRequest, memRequest: memRequest,
    restartPolicy: restartPolicy, backoffLimit: backoffLimit,
    experimentId: context.hfId + ":" + context.appId,
    workflowName: context.wfname, taskName: job.name,
    appId: context.appId
  }

  // Add/override custom parameters for the job
  Object.keys(customParams).forEach(function(key) {
    params[key] = customParams[key];
  });

  // args[v] will evaluate to 'undefined' if 'v' doesn't exist
  var interpolate = (tpl, args) => tpl.replace(/\${(\w+)}/g, (_, v) => args[v]);
  var jobYaml = yaml.safeLoad(interpolate(jobYamlTemplate, params));

  return jobYaml;
}

// Function submitK8sJob
// Submits a job to a Kubernetes cluster and awaits for its completion
//
// Inputs:
// - see inputs to 'createK8sJobYaml' and 'createK8sJobMessage'
// - restartFn - function that will be called in case of failed job
//
//
// Returns: job exit code
var submitK8sJob = async(kubeconfig, jobArr, taskIdArr, contextArr, customParams, restartFn) => {

  let context = contextArr[0];

  // Load definition of the the worker job pod
  // File 'job-template.yaml' should be provided externally during deployment
  var jobTemplatePath = customParams.jobTemplatePath || process.env.HF_VAR_JOB_TEMPLATE_PATH || "./job-template.yaml";
  var jobYamlTemplate = fs.readFileSync(jobTemplatePath, 'utf8');
  //var job = yaml.safeLoad(eval('`'+jobYaml+'`')); // this works, but eval unsafe

  // CAUTION: When creating job YAML first job details (requests, container) are used.
  var jobYaml = createK8sJobYaml(jobArr[0], taskIdArr, context, jobYamlTemplate, customParams);
  let jobMessages = [];
  for (var i=0; i<jobArr.length; i++) {
    let job = jobArr[i];
    let taskId = taskIdArr[i];

    let jobMessage = createK8sJobMessage(job, taskId, context);
    jobMessages.push(jobMessage);
  }

  // Test mode -- just print, do not actually create jobs
  if (process.env.HF_VAR_K8S_TEST=="1") {
    console.log(JSON.stringify(jobYaml, null, 4));
    console.log(JSON.stringify(jobMessages, null, 2));
    return taskIdArr.map(x => 0);
  }

  var namespace = process.env.HF_VAR_NAMESPACE || 'default';

  let taskStart = new Date().toISOString();
  console.log("Starting tasks", taskIdArr, 'time=' + taskStart);

  const k8sApi = kubeconfig.makeApiClient(k8s.BatchV1Api);

  // Create the job via the Kubernetes API. We implement a simple retry logic
  // in case the API is overloaded and returns HTTP 429 (Too many requests).
  var createJob = function(attempt) {
    try {
      k8sApi.createNamespacedJob(namespace, jobYaml).then(
        (response) => {
        },
        (err) => {
          try {
            var statusCode = err.response.statusCode;
          } catch(e) {
            // We didn't get a response, probably connection error
            throw(err);
          }
          switch(statusCode) {
            // if we get 409 or 429 ==> wait and retry
            case 409: // 'Conflict' -- "Operation cannot be fulfilled on reourcequotas"; bug in k8s?
            case 429: // 'Too many requests' -- API overloaded
              // Calculate delay: default 1s, for '429' we should get it in the 'retry-after' header
              let delay = Number(err.response.headers['retry-after'] || 1)*1000;
              console.log("Create k8s job", taskIdArr, "HTTP error " + statusCode + " (attempt " + attempt +
                           "), retrying after " + delay + "ms." );
              setTimeout(() => createJob(attempt+1), delay);
              break;
            default:
              console.error("Err");
              console.error(err);
              console.error(job);
              let taskEnd = new Date().toISOString();
              console.log("Task ended with error, time=", taskEnd);
          }
        }
      );
    } catch (e) {
      console.error(e);
    }
  }
  createJob(1);

  let sendJobMessagesPromises = [];
  for (var i=0; i<jobMessages.length; i++) {
    let taskId = taskIdArr[i];
    let jobMessage = jobMessages[i];
    sendJobMessagesPromises.push(context.sendMsgToJob(JSON.stringify(jobMessage), taskId));
  }
  try {
    console.log("Sending job messages to", taskIdArr);
    await Promise.all(sendJobMessagesPromises);
  } catch (err) {
    console.error(err);
    throw err;
  }

  // 'awaitJob' -- wait for the job to finish, possibly restarting it
  // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
  var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0;
  var restartPolicy = backoffLimit > 0 ? "OnFailure": "Never";
  var restartCount = 0;
  var awaitJob = async(taskId) => {
    try {
      var jobResult = await context.jobResult(0, taskId); // timeout=0 means indefinite
    } catch (err) {
      console.error(err);
      throw err;
    }
    let taskEnd = new Date().toISOString();
    console.log('Job ended with result:', jobResult, 'time:', taskEnd);
    var code = parseInt(jobResult[1]); // job exit code
    return code;
  }

  var awaitJobs = async(taskIdArr) => {
    let awaitPromises = []
    for (var i=0; i<taskIdArr.length; i++) {
      awaitPromises.push(awaitJob(taskIdArr[i]));
    }
    return Promise.all(awaitPromises);
  }

  let jobExitCodes = await awaitJobs(taskIdArr);
  for (let i = 0; i < jobExitCodes.length; i++) {
    let jobExitCode = jobExitCodes[i];
    let taskId = taskIdArr[i];
    if (jobExitCode != 0) {
      console.log("Job", taskId, "failed");
      restartFn(i);
      // NOTE: job message is preserved, so we don't have to send it again.
    }
  }

  return jobExitCodes;
}

exports.submitK8sJob = submitK8sJob;
exports.createK8sJobYaml = createK8sJobYaml;
exports.createK8sJobMessage = createK8sJobMessage;

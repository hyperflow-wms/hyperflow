/**
 * Tests for the creation of a task's Kubernetes Job on the default path of
 * functions/kubernetes/k8sJobSubmit.js (HF_VAR_ADMISSION_CONTROLLER unset):
 *  - functions/kubernetes/k8sJobCreate.js retries transient API errors with
 *    exponential backoff, honours Retry-After, and fails other 4xx errors at
 *    once. AlreadyExists for the Job's own name counts as created only after
 *    an earlier attempt with an unclear result (no HTTP status, 500, 503 or
 *    504); on the first attempt, or after only 429, 409 Conflict or 502, it
 *    fails the task;
 *  - when the Job cannot be created, the tasks' waits end with a failure
 *    exit code through the connector (wflib/connector.js resolveTask), for
 *    both completion transports, whether or not the wait has started, and a
 *    restart of the task can wait for the same task id again.
 *
 * Self-contained: a fake Kubernetes API client and a fake redis client, no
 * live services and no npm dependencies. Retry delays are recorded by an
 * injected sleep function instead of waited for.
 * Run with:  node tests/k8sJobSubmit.js
 */
const assert = require('assert');
const util = require('util');

const unhandledRejections = [];
process.on('unhandledRejection', (reason) => { unhandledRejections.push(reason); });

const jobCreate = require('../functions/kubernetes/k8sJobCreate.js');
const synchronizeJobs = require('../functions/kubernetes/jobSynchronization.js').synchronizeJobs;
const RemoteJobConnector = require('../wflib/connector.js');
const StreamRemoteJobConnector = RemoteJobConnector.StreamRemoteJobConnector;

const FAILED = jobCreate.JOB_CREATE_FAILED_EXIT_CODE;
const JOB_NAME = 'jobx1y2z3-mimgtbl-5-1';
const JOB_YAML = { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: JOB_NAME } };

// ---- Kubernetes API fakes, shaped as client-node 0.12 rejects ----

// A Kubernetes Status object as the API server sends it.
function k8sStatus(code, reason, message, name) {
    return {
        kind: 'Status', apiVersion: 'v1', metadata: {}, status: 'Failure',
        message: message, reason: reason, code: code,
        details: name ? { name: name, group: 'batch', kind: 'jobs' } : undefined,
    };
}

// client-node 0.12 rejects with an HttpError whose 'body' is the Status
// parsed as a V1Job (only apiVersion, kind, metadata, spec and status
// survive), while 'response.body' keeps the Status as received.
function httpError(code, reason, message, options) {
    options = options || {};
    const status = k8sStatus(code, reason, message, options.name);
    const err = new Error('HTTP request failed');
    err.name = 'HttpError';
    err.statusCode = code;
    err.response = { statusCode: code, headers: options.headers || {}, body: status };
    err.body = { apiVersion: 'v1', kind: 'Status', metadata: {}, spec: undefined, status: {} };
    return err;
}

function connectionError(code) {
    const err = new Error('socket hang up');
    err.code = code;
    return err;
}

const e500 = () => httpError(500, 'InternalError',
    'Internal error occurred: resource quota evaluation timed out');
const tooManyRequests = () => httpError(429, 'TooManyRequests', 'slow down');
const conflict = () => httpError(409, 'Conflict',
    'Operation cannot be fulfilled on resourcequotas "quota": the object has been modified');
const alreadyExists = () => httpError(409, 'AlreadyExists',
    'jobs.batch "' + JOB_NAME + '" already exists', { name: JOB_NAME });
const CREATED = { created: true };

// Fake BatchV1Api: answers the n-th createNamespacedJob call with outcomes[n],
// repeating the last outcome. An outcome is CREATED or a value to reject with.
class FakeBatchApi {
    constructor(outcomes) {
        this.outcomes = outcomes;
        this.calls = 0;
    }
    createNamespacedJob(namespace, body) {
        const outcome = this.outcomes[Math.min(this.calls, this.outcomes.length - 1)];
        this.calls++;
        if (outcome === CREATED) {
            return Promise.resolve({ response: { statusCode: 201 }, body: body });
        }
        return Promise.reject(typeof outcome === 'function' ? outcome() : outcome);
    }
}

// Records requested delays and returns at once.
function delayRecorder() {
    const delays = [];
    return { delays: delays, sleep: (ms) => { delays.push(ms); return Promise.resolve(); } };
}

// ---- completion transports ----

// Minimal redis fake for the set transport (RemoteJobConnector).
class FakeSetRedis {
    constructor() { this.sets = {}; }
    _set(key) {
        if (!this.sets[key]) this.sets[key] = new Set();
        return this.sets[key];
    }
    sadd(key, member, cb) {
        this._set(key).add(String(member));
        if (cb) setImmediate(cb, null, 1);
    }
    srandmember(key, cb) {
        const s = this.sets[key];
        setImmediate(cb, null, (s && s.size) ? s.values().next().value : null);
    }
    spop(key, cb) {
        const s = this.sets[key];
        let v = null;
        if (s && s.size) {
            v = s.values().next().value;
            s.delete(v);
        }
        setImmediate(cb, null, v);
    }
    srem(key, member, cb) {
        const s = this.sets[key];
        setImmediate(cb, null, (s && s.delete(String(member))) ? 1 : 0);
    }
}

// Task contexts wired to the connector as wflib/index.js wires them.
function contextFor(connector, name) {
    return {
        name: name,
        jobResult: async (timeout, taskId) => connector.waitForTask(taskId, name),
        resolveJobResult: (code, taskId) => connector.resolveTask(taskId, code),
    };
}

function setTransport() {
    const rcl = new FakeSetRedis();
    const wfId = '1';
    const connector = new RemoteJobConnector(rcl, wfId, 5);
    connector.run();
    return {
        name: 'set',
        connector: connector,
        // A job executor's completion notice.
        complete: (taskId, code) => {
            rcl.sadd(taskId, String(code));
            rcl.sadd('wf:' + wfId + ':tasksPendingCompletionHandling', taskId);
        },
        stop: () => connector.stop(),
    };
}

function streamTransport() {
    // No read loop: complete() hands a completion event to the connector the
    // way the loop does for each entry it reads from the stream.
    const connector = new StreamRemoteJobConnector(null, 'hftest');
    return {
        name: 'stream',
        connector: connector,
        complete: (taskId, code) => connector._handleEntry(taskId, String(code)),
        stop: () => connector.stop(),
    };
}

// ---- helpers ----

function withTimeout(promise, ms, what) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timed out after ' + ms + 'ms: ' + what)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Runs Job creation and the tasks' waits the way k8sCommandGroup does:
// creation in the background, then synchronizeJobs. With 'creationFirst',
// creation ends before the waits start.
async function submitAndWait(transport, taskIds, api, options, creationFirst) {
    const contexts = taskIds.map(() => contextFor(transport.connector, 'mImgtbl'));
    const creation = jobCreate.startJobCreation(api, 'ns', JOB_YAML, taskIds, contexts, options);
    if (creationFirst) {
        await creation;
    }
    const restarts = [];
    const sync = synchronizeJobs(taskIds.map(() => ({})), taskIds, contexts, {},
        (i) => restarts.push(i));
    const waitsStarted = taskIds.every((id) => transport.connector.jobPromiseResolves[id] !== undefined);
    const codes = await withTimeout(sync, 1000, 'waiting for tasks ' + taskIds.join(', '));
    return { codes: codes, restarts: restarts, result: await creation, waitsStarted: waitsStarted };
}

// Runs a test with the modules' console output captured; prints it only if
// the test fails.
let testNumber = 0;
async function test(title, fn) {
    testNumber++;
    const logs = [];
    const saved = { log: console.log, error: console.error };
    console.log = console.error = (...args) => logs.push(util.format(...args));
    try {
        await fn(logs);
    } catch (err) {
        console.log = saved.log;
        console.error = saved.error;
        console.error(logs.join('\n'));
        console.log('not ok ' + testNumber + ' - ' + title);
        throw err;
    }
    console.log = saved.log;
    console.error = saved.error;
    console.log('ok ' + testNumber + ' - ' + title);
}

// ---- tests ----

async function main() {
    delete process.env.HF_VAR_JOB_CREATE_RETRIES;
    const one = () => 1; // jitter at its maximum: delays are the backoff ceilings
    const setT = setTransport();
    const streamT = streamTransport();

    await test('500 then success: the Job is created and the task waits for its real completion', async (logs) => {
        const api = new FakeBatchApi([e500, CREATED]);
        const rec = delayRecorder();
        const taskId = 'hf:1:5:1';
        const contexts = [contextFor(setT.connector, 'mImgtbl')];
        const result = await jobCreate.startJobCreation(api, 'ns', JOB_YAML, [taskId], contexts,
            { sleep: rec.sleep, random: one });
        assert.strictEqual(result.created, true);
        assert.strictEqual(api.calls, 2);
        assert.deepStrictEqual(rec.delays, [1000]);
        const retryLog = logs.find((l) => /attempt 1 of 11/.test(l));
        assert.ok(retryLog && retryLog.includes(taskId) && /status 500/.test(retryLog) &&
                  /retrying in 1000ms/.test(retryLog), 'retry log line: ' + retryLog);

        const sync = synchronizeJobs([{}], [taskId], contexts, {}, () => {});
        await tick();
        assert.notStrictEqual(setT.connector.jobPromiseResolves[taskId], undefined,
            'the wait ended without a completion notice');
        setT.complete(taskId, 0);
        assert.deepStrictEqual(await withTimeout(sync, 1000, 'completion'), [0]);
    });

    await test('connection error then success, with no unhandled rejection', async () => {
        const api = new FakeBatchApi([connectionError('ECONNRESET'), CREATED]);
        const rec = delayRecorder();
        const result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:6:1'],
            { sleep: rec.sleep, random: one });
        assert.strictEqual(result.created, true);
        assert.strictEqual(api.calls, 2);
        await tick();
        assert.strictEqual(unhandledRejections.length, 0, 'unhandled rejection: ' + unhandledRejections[0]);
    });

    await test('connection errors of any kind are retried, and a final one fails the task without an unhandled rejection', async () => {
        const api = new FakeBatchApi([connectionError('ETIMEDOUT'), connectionError('ECONNREFUSED'),
                                      connectionError('EAI_AGAIN'), undefined, CREATED]);
        const rec = delayRecorder();
        const result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:7:1'],
            { sleep: rec.sleep, random: one });
        assert.strictEqual(result.created, true);
        assert.strictEqual(api.calls, 5);

        const r = await submitAndWait(setT, ['hf:1:7:2'],
            new FakeBatchApi([connectionError('ECONNRESET')]), { retries: 0, sleep: rec.sleep }, false);
        assert.deepStrictEqual(r.codes, [FAILED]);
        await tick();
        assert.strictEqual(unhandledRejections.length, 0, 'unhandled rejection: ' + unhandledRejections[0]);
    });

    await test('409 AlreadyExists for this Job after a 500 counts as created, with no more retries', async () => {
        const api = new FakeBatchApi([e500,
            () => httpError(409, 'AlreadyExists', 'jobs.batch "' + JOB_NAME + '" already exists', { name: JOB_NAME }),
            e500]);
        const rec = delayRecorder();
        const result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:8:1'],
            { sleep: rec.sleep, random: one });
        assert.strictEqual(result.created, true);
        assert.strictEqual(api.calls, 2);
        assert.deepStrictEqual(rec.delays, [1000]);
    });

    await test('409 AlreadyExists for this Job on the first attempt fails the task with no retry', async (logs) => {
        const api = new FakeBatchApi([alreadyExists, CREATED]);
        const rec = delayRecorder();
        const r = await submitAndWait(setT, ['hf:1:18:1'], api, { sleep: rec.sleep, random: one }, false);
        assert.strictEqual(api.calls, 1);
        assert.deepStrictEqual(rec.delays, []);
        assert.strictEqual(r.result.created, false);
        assert.strictEqual(r.result.statusCode, 409);
        assert.deepStrictEqual(r.codes, [FAILED]);
        assert.deepStrictEqual(r.restarts, [0]);
        const failLog = logs.find((l) => /failed for good/.test(l));
        assert.ok(failLog && /no earlier attempt of unclear result/.test(failLog),
            'final log line: ' + failLog);
    });

    await test('409 AlreadyExists for this Job after only 429, 409 Conflict or 502 fails the task', async (logs) => {
        const e502 = () => httpError(502, 'BadGateway', 'bad gateway');
        const cases = [
            ['429', [tooManyRequests, alreadyExists, CREATED]],
            ['409 Conflict', [conflict, alreadyExists, CREATED]],
            ['429 and 409 Conflict', [tooManyRequests, conflict, tooManyRequests, alreadyExists, CREATED]],
            ['502', [e502, alreadyExists, CREATED]],
        ];
        for (let i = 0; i < cases.length; i++) {
            const [what, outcomes] = cases[i];
            const api = new FakeBatchApi(outcomes);
            const rec = delayRecorder();
            const r = await submitAndWait(setT, ['hf:1:19:' + (i + 1)], api,
                { sleep: rec.sleep, random: one }, false);
            const calls = outcomes.length - 1;
            assert.strictEqual(api.calls, calls, 'after ' + what + ': calls');
            assert.strictEqual(rec.delays.length, calls - 1, 'after ' + what + ': retries');
            assert.strictEqual(r.result.created, false, 'after ' + what + ': counted as created');
            assert.strictEqual(r.result.statusCode, 409, 'after ' + what + ': status');
            assert.deepStrictEqual(r.codes, [FAILED], 'after ' + what + ': exit codes');
        }
        assert.strictEqual(logs.filter((l) => /no earlier attempt of unclear result/.test(l)).length,
            cases.length);

        // 409 Conflict and 429 still count against the retry limit.
        for (const error of [conflict, tooManyRequests]) {
            const api = new FakeBatchApi([error]);
            const result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:19:9'],
                { retries: 2, sleep: delayRecorder().sleep });
            assert.strictEqual(result.created, false);
            assert.strictEqual(api.calls, 3);
        }
    });

    await test('409 AlreadyExists for this Job after a connection error, a 503, a 504, or a timeout and then 429 counts as created', async (logs) => {
        const cases = [
            ['a connection error', [connectionError('ECONNRESET'), alreadyExists, e500]],
            ['a rejection with no error object', [undefined, alreadyExists, e500]],
            ['503', [() => httpError(503, 'ServiceUnavailable', 'unavailable'), alreadyExists, e500]],
            ['504', [() => httpError(504, 'Timeout', 'request timed out'), alreadyExists, e500]],
            ['a timeout and then 429', [connectionError('ETIMEDOUT'), tooManyRequests, alreadyExists, e500]],
        ];
        for (let i = 0; i < cases.length; i++) {
            const [what, outcomes] = cases[i];
            const api = new FakeBatchApi(outcomes);
            const rec = delayRecorder();
            const result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:20:' + (i + 1)],
                { sleep: rec.sleep, random: one });
            assert.strictEqual(result.created, true, 'after ' + what + ': not counted as created');
            assert.strictEqual(api.calls, outcomes.length - 1, 'after ' + what + ': calls');
        }
        const createdLog = logs.find((l) => /counting it as created/.test(l));
        assert.ok(createdLog && /attempt 1 had an unclear result/.test(createdLog),
            'log line: ' + createdLog);
    });

    await test('409 AlreadyExists for another name fails, also after an unclear attempt; 409 Conflict is retried', async () => {
        const otherExists = () => httpError(409, 'AlreadyExists', 'exists', { name: 'other-job' });
        let api = new FakeBatchApi([otherExists]);
        let result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:9:1'],
            { sleep: delayRecorder().sleep });
        assert.strictEqual(result.created, false);
        assert.strictEqual(api.calls, 1);

        const unclearFirst = [['a 500', e500], ['a connection error', connectionError('ECONNRESET')]];
        for (let i = 0; i < unclearFirst.length; i++) {
            const [what, error] = unclearFirst[i];
            api = new FakeBatchApi([error, otherExists, CREATED]);
            const r = await submitAndWait(setT, ['hf:1:9:' + (i + 3)], api,
                { sleep: delayRecorder().sleep, random: one }, false);
            assert.strictEqual(r.result.created, false, 'after ' + what + ': counted as created');
            assert.strictEqual(api.calls, 2, 'after ' + what + ': calls');
            assert.deepStrictEqual(r.codes, [FAILED], 'after ' + what + ': exit codes');
        }

        api = new FakeBatchApi([() => httpError(409, 'Conflict',
            'Operation cannot be fulfilled on resourcequotas "quota": the object has been modified'), CREATED]);
        result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:9:2'],
            { sleep: delayRecorder().sleep });
        assert.strictEqual(result.created, true);
        assert.strictEqual(api.calls, 2);
    });

    await test('403: no retry, and both tasks of the Job fail', async () => {
        const api = new FakeBatchApi([() => httpError(403, 'Forbidden', 'jobs.batch is forbidden'), CREATED]);
        const rec = delayRecorder();
        const r = await submitAndWait(setT, ['hf:1:10:1', 'hf:1:11:1'], api, { sleep: rec.sleep }, false);
        assert.strictEqual(r.waitsStarted, true, 'the waits should start before the failure arrives');
        assert.strictEqual(api.calls, 1);
        assert.deepStrictEqual(rec.delays, []);
        assert.deepStrictEqual(r.codes, [FAILED, FAILED]);
        assert.deepStrictEqual(r.restarts, [0, 1]);
    });

    await test('other 4xx errors (400, 401, 404, 422) are not retried', async () => {
        for (const code of [400, 401, 404, 422]) {
            const api = new FakeBatchApi([() => httpError(code, 'Invalid', 'rejected'), CREATED]);
            const result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:12:1'],
                { sleep: delayRecorder().sleep });
            assert.strictEqual(result.created, false, 'HTTP ' + code + ' should fail');
            assert.strictEqual(api.calls, 1, 'HTTP ' + code + ' was retried');
        }
    });

    await test('500 on every attempt stops at HF_VAR_JOB_CREATE_RETRIES, and the task fails instead of waiting forever', async () => {
        process.env.HF_VAR_JOB_CREATE_RETRIES = '3';
        try {
            const api = new FakeBatchApi([e500]);
            const rec = delayRecorder();
            const r = await submitAndWait(setT, ['hf:1:13:1'], api, { sleep: rec.sleep, random: one }, false);
            assert.strictEqual(api.calls, 4);
            assert.deepStrictEqual(rec.delays, [1000, 2000, 4000]);
            assert.strictEqual(r.result.created, false);
            assert.strictEqual(r.result.statusCode, 500);
            assert.deepStrictEqual(r.codes, [FAILED]);
            assert.deepStrictEqual(r.restarts, [0]);
        } finally {
            delete process.env.HF_VAR_JOB_CREATE_RETRIES;
        }
    });

    await test('default limit is 10 retries, with doubling delays capped at 30 s and jitter down to half', async () => {
        let api = new FakeBatchApi([e500]);
        let rec = delayRecorder();
        await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:14:1'], { sleep: rec.sleep, random: one });
        assert.strictEqual(api.calls, 11);
        assert.deepStrictEqual(rec.delays,
            [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000]);

        api = new FakeBatchApi([e500]);
        rec = delayRecorder();
        await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:14:2'], { sleep: rec.sleep, random: () => 0 });
        assert.deepStrictEqual(rec.delays,
            [500, 1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000]);

        for (const [value, calls] of [['0', 1], ['abc', 11], ['-2', 11]]) {
            process.env.HF_VAR_JOB_CREATE_RETRIES = value;
            api = new FakeBatchApi([e500]);
            await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:14:3'], { sleep: delayRecorder().sleep });
            assert.strictEqual(api.calls, calls, 'HF_VAR_JOB_CREATE_RETRIES=' + value);
        }
        delete process.env.HF_VAR_JOB_CREATE_RETRIES;
    });

    await test('Retry-After is honoured as a lower bound on the delay, up to the 30 s cap', async () => {
        const tooMany = (retryAfter) => () => httpError(429, 'TooManyRequests', 'slow down',
            { headers: { 'retry-after': retryAfter } });
        let api = new FakeBatchApi([tooMany('7'), tooMany('120'), e500,
            () => httpError(503, 'ServiceUnavailable', 'unavailable', { headers: { 'retry-after': '1' } }),
            CREATED]);
        let rec = delayRecorder();
        let result = await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:15:1'],
            { sleep: rec.sleep, random: one });
        assert.strictEqual(result.created, true);
        // 7 s over a 1 s backoff; 120 s capped at 30 s; plain backoff 4 s;
        // 8 s backoff over a 1 s Retry-After.
        assert.deepStrictEqual(rec.delays, [7000, 30000, 4000, 8000]);

        const date = new Date(Date.now() + 10000).toUTCString();
        api = new FakeBatchApi([tooMany(date), CREATED]);
        rec = delayRecorder();
        await jobCreate.createJobWithRetries(api, 'ns', JOB_YAML, ['hf:1:15:2'], { sleep: rec.sleep, random: one });
        assert.ok(rec.delays[0] >= 8000 && rec.delays[0] <= 10000,
            'HTTP-date Retry-After gave ' + rec.delays[0] + 'ms');
    });

    for (const t of [setT, streamT]) {
        await test(t.name + ': a 403 that arrives before the wait starts still fails the task, also on its restart', async () => {
            const taskId = 'hf:1:16:1';
            const forbidden = () => httpError(403, 'Forbidden', 'jobs.batch is forbidden');
            let r = await submitAndWait(t, [taskId], new FakeBatchApi([forbidden]), {}, true);
            assert.strictEqual(r.result.created, false);
            assert.deepStrictEqual(r.codes, [FAILED]);
            // The restart's creation fails before its wait starts as well.
            r = await submitAndWait(t, [taskId], new FakeBatchApi([forbidden]), {}, true);
            assert.deepStrictEqual(r.codes, [FAILED]);
            assert.strictEqual(t.connector.earlyEvents[taskId], undefined, 'a result was left behind');
        });

        await test(t.name + ': after creation fails for good, a restart waits for the same task id again', async (logs) => {
            const taskId = 'hf:1:17:1';
            const rec = delayRecorder();
            let r = await submitAndWait(t, [taskId], new FakeBatchApi([e500]),
                { retries: 2, sleep: rec.sleep }, false);
            assert.strictEqual(r.waitsStarted, true);
            assert.deepStrictEqual(r.codes, [FAILED]);
            assert.deepStrictEqual(r.restarts, [0]);
            assert.strictEqual(t.connector.jobPromiseResolves[taskId], undefined, 'the failed wait is still registered');

            // Restart: the Job is created, and its executor reports exit code 0.
            const contexts = [contextFor(t.connector, 'mImgtbl')];
            const creation = jobCreate.startJobCreation(new FakeBatchApi([CREATED]), 'ns', JOB_YAML,
                [taskId], contexts, {});
            const sync = synchronizeJobs([{}], [taskId], contexts, {}, () => {});
            assert.notStrictEqual(t.connector.jobPromiseResolves[taskId], undefined, 'the restart did not start a wait');
            assert.strictEqual((await creation).created, true);
            t.complete(taskId, 0);
            assert.deepStrictEqual(await withTimeout(sync, 1000, 'restarted task'), [0]);
            assert.ok(!logs.some((l) => /already observed/.test(l)), 'connector reported the task as already observed');
        });
    }

    await setT.stop();
    await streamT.stop();
    await tick();
    assert.strictEqual(unhandledRejections.length, 0, 'unhandled rejection: ' + unhandledRejections[0]);
    console.log("all k8s job creation tests passed");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

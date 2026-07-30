const taskLabel = require('../../common/taskLabel').taskLabel;
const clog = require('../../common/consoleLogger');

async function synchronizeJobs(jobArr, taskIdArr, contextArr, customParams, restartFn) {

    let context = contextArr[0];
    // 'awaitJob' -- wait for the job to finish, possibly restarting it
    // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
    var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0;
    var restartPolicy = backoffLimit > 0 ? "OnFailure" : "Never";
    var restartCount = 0;
    var awaitJob = async (taskId, name) => {
        const c = clog.color;
        let waitStart = Date.now();
        try {
            var jobResult = await context.jobResult(0, taskId); // timeout=0 means indefinite
        } catch (err) {
            clog.error(err);
            throw err;
        }
        let taskEnd = new Date().toISOString();
        let code = parseInt(jobResult[1]);
        let failed = code !== 0;
        clog.info(c.dim('[hf] task'),
                  failed ? c.failed('failed:') : c.finished('finished:'),
                  c.task(name), c.dim('(' + taskId + ')'),
                  failed ? c.failed('exit=' + code) : c.dim('exit=0'),
                  c.time('time=' + ((Date.now() - waitStart) / 1000).toFixed(1) + 's'));
        clog.debug('Job', taskLabel(taskId, name), 'ended with result:', jobResult, 'time:', taskEnd);
        return code;
    }

    var awaitJobs = async (taskIdArr) => {
        let awaitPromises = []
        for (var i = 0; i < taskIdArr.length; i++) {
            awaitPromises.push(awaitJob(taskIdArr[i], contextArr[i].name));
        }
        return Promise.all(awaitPromises);
    }

    let jobExitCodes = await awaitJobs(taskIdArr);
    for (let i = 0; i < jobExitCodes.length; i++) {
        let jobExitCode = jobExitCodes[i];
        let taskId = taskIdArr[i];
        let name = contextArr[i].name;
        if (jobExitCode !== 0) {
            clog.debug("Job", taskLabel(taskId, name), "failed");
            restartFn(i);
            // NOTE: job message is preserved, so we don't have to send it again.
        }
    }

    return jobExitCodes;

}

exports.synchronizeJobs = synchronizeJobs

async function synchronizeJobs(jobArr, taskIdArr, contextArr, customParams, restartFn) {

    let context = contextArr[0];
    // 'awaitJob' -- wait for the job to finish, possibly restarting it
    // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
    var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0;
    var restartPolicy = backoffLimit > 0 ? "OnFailure" : "Never";
    var restartCount = 0;
    var awaitJob = async (taskId) => {
        try {
            var jobResult = await context.jobResult(0, taskId); // timeout=0 means indefinite
        } catch (err) {
            console.error(err);
            throw err;
        }
        let taskEnd = new Date().toISOString();
        console.log('Job ended with result:', jobResult, 'time:', taskEnd);
         // job exit code
        return parseInt(jobResult[1]);
    }

    var awaitJobs = async (taskIdArr) => {
        let awaitPromises = []
        for (var i = 0; i < taskIdArr.length; i++) {
            awaitPromises.push(awaitJob(taskIdArr[i]));
        }
        return Promise.all(awaitPromises);
    }

    let jobExitCodes = await awaitJobs(taskIdArr);
    for (let i = 0; i < jobExitCodes.length; i++) {
        let jobExitCode = jobExitCodes[i];
        let taskId = taskIdArr[i];
        if (jobExitCode !== 0) {
            console.log("Job", taskId, "failed");
            restartFn(i);
            // NOTE: job message is preserved, so we don't have to send it again.
        }
    }

    return jobExitCodes;

}

exports.synchronizeJobs = synchronizeJobs
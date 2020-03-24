const request = require('requestretry');
let runningTasks = 0;
let completed = 0;
let failed = 0;
const retryCodes = new Set([400, 429, 500, 502, 503])

async function cloudRunCommand(ins, outs, config, cb) {

    while (runningTasks >= 1000) { // AWS Fargate supports up to 50 instances at a given time
        await sleep(3000);
    }
    runningTasks++;

    const executor_config = await getConfig(config.workdir);

    const options = executor_config.options;
    if (config.executor.hasOwnProperty('options')) {
        let executorOptions = config.executor.options;
        for (let opt in executorOptions) {
            if (executorOptions.hasOwnProperty(opt)) {
                options[opt] = executorOptions[opt];
            }
        }
    }

    const executable = config.executor.executable;
    const jobMessage = {
        "executable": executable,
        "args": config.executor.args,
        "env": (config.executor.env || {}),
        "inputs": ins.map(i => i),
        "outputs": outs.map(o => o),
        "options": options,
        "stdout": config.executor.stdout
    };

    const url = executor_config.service_url;

    console.log(new Date() + " Executing: " + JSON.stringify(jobMessage) + "@" + url);

    const fireTime = Date.now();

    request.post({
        timeout: 900000,
        url: url,
        json: jobMessage,
        maxAttempts: 1,
        retryDelay: 3000,
        retryStrategy: retry,
        headers: {'Content-Type': 'application/json', 'Accept': '*/*'}
    })
        .then(async function (response) {
            if (response) {
                console.log("Function: " + executable + " response status code: " + response.statusCode + " number of request attempts: " + response.attempts);
                console.log("Metrics: task: " + executable + " fire time " + fireTime + " " + response.body);
            }
            if(response.statusCode === 200) {
               completed++;
            } else {
                failed++;
            }
            console.log(new Date() + " Cloud Run task: " + executable + " completed successfully.");
            console.log("Completed - " + completed + ", failed - " + failed);
            cb(null, outs);
        })
        .catch(function (error) {
            console.log("Function: " + executable + " error: " + error);
            cb(error, outs);
        });

    function retry(err, response) {
        if(response === undefined) {
            return true;
        }
        if (retryCodes.has(response.statusCode)) {
            console.log("Error: " + response.body + " Retrying " + executable);
            return true;
        }
        if (response.statusCode === 504) {
            console.log(executable + " timeout!")
        }
        return false;
    }

    async function getConfig(workdir) {
        let config;
        try {
            config = require(workdir + "/cloudRunCommand.config.js");
        } catch (e) {
            console.log("No config in " + workdir + ", loading config from default location: .");
            config = require("./cloudRunCommand.config.js");
        }
        return config;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

exports.cloudRunCommand = cloudRunCommand;

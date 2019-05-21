const request = require('requestretry');
const aws = require("aws-sdk");
const s3 = new aws.S3();
const s3LogCheckRetryFrequency = 10000; // milliseconds

async function awsLambdaCommand(ins, outs, config, cb) {

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

    let logName;
    if (executor_config.S3_metrics) {
        logName = (Math.random() * 1e12).toString(36);
    }

    const executable = config.executor.executable;
    const jobMessage = {
        "executable": executable,
        "args": config.executor.args,
        "env": (config.executor.env || {}),
        "inputs": ins.map(i => i),
        "outputs": outs.map(o => o),
        "options": options,
        "stdout": config.executor.stdout,
        "logName": logName
    };

    const url = executor_config.service_url;

    console.log("Executing: " + JSON.stringify(jobMessage) + "@" + url);

    const fireTime = Date.now();

    request.post({
        timeout: 600000,
        url: url,
        json: jobMessage,
        retryStrategy: retry,
        headers: {'Content-Type': 'application/json', 'Accept': '*/*'}
    })
        .then(async function (response) {
            if (response) {
                console.log("Function: " + executable + " response status code: " + response.statusCode + " number of request attempts: " + response.attempts)
            }
            if (executor_config.S3_metrics) {
                await waitForLogs(1)
            } else {
                console.log("Metrics: task: " + executable + " fire time " + fireTime + " " + response.body);
            }
            console.log("Lambda task: " + executable + " completed successfully.");
            cb(null, outs);
        })
        .catch(function (error) {
            console.log("Function: " + executable + " error: " + error);
            cb(error, outs);
        });

    async function waitForLogs(retry) {
        if ((retry * s3LogCheckRetryFrequency) / 1000 > 900) { // lambda can execute up to 900 seconds
            console.log("Error - waiting over 15 minutes. Terminating.");
            cb("Error", outs);
        }
        console.log("Waiting for S3 logs, retry number: " + retry);
        await getS3Logs()
            .catch(() => {
                return sleep(s3LogCheckRetryFrequency)
                    .then(waitForLogs.bind(null, retry + 1));
            });
    }

    async function getS3Logs() {
        const params = {
            Bucket: options.bucket,
            Key: "logs/" + logName
        };
        await s3.getObject(params).promise().then(async function (data) {
            console.log("Metrics: task: " + executable + " fire time " + fireTime + " " + data.Body.toString());
        });
    }

    function retry(err, response) {
        if (response.statusCode === 502 || response.statusCode === 400 || response.statusCode === 500) {
            console.log("Error: " + err + ", retrying " + executable);
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
            config = require(workdir + "/awsLambdaCommand.config.js");
        } catch (e) {
            console.log("No config in " + workdir + ", loading config from default location: .");
            config = require("./awsLambdaCommand.config.js");
        }
        return config;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

exports.awsLambdaCommand = awsLambdaCommand;

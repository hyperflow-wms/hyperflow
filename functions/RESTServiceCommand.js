const request = require('requestretry');

async function RESTServiceCommand(ins, outs, config, cb) {

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

    console.log("Executing: " + JSON.stringify(jobMessage) + "@" + url);

    const fireTime = Date.now();

    request.post({
        timeout: 600000,
        url: url,
        json: jobMessage,
        retryStrategy: retry,
        headers: {'Content-Type': 'application/json', 'Accept': '*/*'}
    })
        .then(function (response) {
            if (response) {
                console.log("Function: " + executable + " response status code: " + response.statusCode + " number of request attempts: " + response.attempts)
            }
            console.log("Lambda task: " + executable + " completed successfully.");
            console.log("Metrics: task: " + executable + " fire time " + fireTime + " " + response.body);
            cb(null, outs);
        })
        .catch(function (error) {
            console.log("Function: " + executable + " error: " + error);
            cb(error, outs);
        });

    function retry(err, response) {
        if (response.statusCode === 502 || response.statusCode === 400 || response.statusCode === 500) {
            console.log("Retrying " + executable);
            return true;
        }
        return false;
    }

    async function getConfig(workdir) {
        let config;
        try {
            config = require(workdir + "/RESTServiceCommand.config.js");
        } catch (e) {
            console.log("No config in " + workdir + ", loading config from default location: .");
            config = require("./RESTServiceCommand.config.js");
        }
        return config;
    }
}

exports.RESTServiceCommand = RESTServiceCommand;

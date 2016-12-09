//var request = require('request');
var request = require('requestretry');
var executor_config = require('./gcfCommand.config.js');
var identity = function(e) {return e};



function gcfCommand(ins, outs, config, cb) {

    var options = executor_config.options;
    if(config.executor.hasOwnProperty('options')) {
        var executorOptions = config.executor.options;
        for (var opt in executorOptions) {
            if(executorOptions.hasOwnProperty(opt)) {
                options[opt] = executorOptions[opt];
            }
        }
    }
    var executable = config.executor.executable
    var jobMessage = {
        "executable": executable,
        "args":       config.executor.args,
        "env":        (config.executor.env || {}),
        "inputs":     ins.map(identity),
        "outputs":    outs.map(identity),
        "options":    options
    };

    console.log("Executing:  " + JSON.stringify(jobMessage))

    var url = executor_config.gcf_url

    function optionalCallback(err, response, body) {
        if (err) {
            console.log("Function: " + executable + " error: " + err);
            cb(err, outs);
            return
        }
        if (response) {
             console.log("Function: " + executable + " response status code: " + response.statusCode + " number of request attempts: " + response.attempts)
        }
        console.log("Function: " + executable + " data: " + body.toString())
        cb(null, outs);
    }


    var req = request.post(
        {timeout:600000, url:url, json:jobMessage, headers: {'Content-Type' : 'application/json', 'Accept': '*/*'}}, optionalCallback);


}


exports.gcfCommand = gcfCommand;

var request = require('request');
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
    var jobMessage = {
        "executable": config.executor.executable,
        "args":       config.executor.args,
        "env":        (config.executor.env || {}),
        "inputs":     ins.map(identity),
        "outputs":    outs.map(identity),
        "options":    options
    };

    console.log("Executing:  " + JSON.stringify(jobMessage))

    var url = executor_config.gcf_url

    var req = request.post(
        {url:url, json:jobMessage, headers: {'Content-Type' : 'application/json', 'Accept': '*/*'}});

    req.on('error', function(err) {
        console.log(err);
        cb(err, outs);
    })

    req.on('response', function(response) {
        console.log("got response")
    })

    req.on('data', function(body) {
        console.log(body.toString())
    })

    req.on('end', function(body) {
        console.log("got end");
        cb(null, outs);
    })

}


exports.gcfCommand = gcfCommand;

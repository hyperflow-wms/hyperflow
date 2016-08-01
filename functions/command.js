var spawn = require('child_process').spawn;
var logger = require('winston').loggers.get('workflow');

function command(ins, outs, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    logger.info("Executing:", exec, args);

//    var proc = spawn(exec, [ args ]);
    var proc = spawn(exec,  args );

    proc.stdout.on('data', function(data) {
        logger.info(exec, 'stdout:' + data);
    });

    proc.stderr.on('data', function(data) {
        logger.info(exec, 'stderr:' + data);
    });

    proc.on('exit', function(code) {
        logger.info(exec, 'exiting with code:' + code);
        cb(null, outs);
    });

    proc.on('close', function (code, signal) {
        logger.error(exec, 'terminated due to receipt of signal '+signal);
    });
}

function command_print(ins, outs, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    logger.verbose('%s %s', exec, args);

    cb(null, outs);
}

function command_notifyevents(ins, outs, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    var eventServer = config['eventServer'];
    if(typeof eventServer !== 'undefined' && eventServer) {
        eventServer.emit("trace.job", exec, args);
    } else {
        logger.info("loged: " + exec, args);
    }
    cb(null, outs);
}


exports.command = command;
exports.command_print = command_print;
exports.command_notifyevents = command_notifyevents;
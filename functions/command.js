var spawn = require('child_process').spawn;

function command(ins, outs, executor, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    console.log("Executing:", exec, args);

    var proc = spawn(exec, [ args ]);

    proc.stdout.on('data', function(data) {
        console.log(exec, 'stdout:' + data);
    });

    proc.stderr.on('data', function(data) {
        console.log(exec, 'stderr:' + data);
    });

    proc.on('exit', function(code) {
        console.log(exec, 'exiting with code:' + code);
        cb(null, outs);
    });

    proc.on('close', function (code, signal) {
        console.log(exec, 'terminated due to receipt of signal '+signal);
    });
}

function command_print(ins, outs, executor, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    console.log(exec, args);

    cb(null, outs);
}

exports.command = command;
exports.command_print = command_print;

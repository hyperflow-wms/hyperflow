function command(ins, outs, executor, config, cb) {
    if (0/*executor*/) {
        executor(ins, outs, config, function(err, outs) {
            err ? cb(err): cb(null, outs);
        });
    } else {
        console.log(config.executor.executable, config.executor.args);
        cb(null, outs);
    }
}

exports.command = command;

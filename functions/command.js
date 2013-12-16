function command(ins, outs, executor, config, cb) {
    if (0/*executor*/) {
        executor.execute(ins, outs, config, function(err, outs) {
            err ? cb(err): cb(null, outs);
        });
    } else {
        console.log(config.executor.executable, config.executor.args);
	setTimeout(function() {
		cb(null, outs);
	}, Math.floor((Math.random()*0)+0));
    }
}

exports.command = command;

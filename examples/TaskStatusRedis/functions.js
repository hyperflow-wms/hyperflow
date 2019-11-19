var spawn = require('child_process').spawn;

// Spawns a job "node handler.js" and waits for the notification of its
// completion using the Redis task status notification mechanism
async function task_status_redis_test(ins, outs, context, cb) {
    var n = Number(ins.number.data[0]); 

    //console.log("Spawning process...");

    var proc = spawn('node', ['handler.js', context.taskId, context.redis_url]);

    proc.stderr.on('data', function(data) {
	console.log(data.toString());
    });

    proc.stdout.on('data', function(data) {
	console.log(data.toString());
    });

    proc.on('exit', function(code) {
	//console.log('Process exited with code', code);
    });

    // wait for the task to finish indefinitely (timeout=0)
    try {
        var taskStatus = await context.taskStatus(0);
	console.log('Received task status:', taskStatus);
        setTimeout(function() {
	    cb(null, outs);
	 }, 5000);
    } catch(err) {
        console.err(err);
	throw err;
    }
}

exports.task_status_redis_test = task_status_redis_test;

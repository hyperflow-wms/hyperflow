// Executor of 'jobs' using the Redis task status notification mechanism
var redis = require('redis');

if (process.argv.length < 4) {
    console.err("Usage: node handler.js <taskId> <redis_url>");
    process.exit(1);
}

// 'taskId' is the name of the Redis list to use for the notification
var taskId = process.argv[2],
    redis_url = process.argv[3];

//console.log("taskId", taskId);
//console.log("redis_url", redis_url);

var rcl = redis.createClient(redis_url);

// After some delay, push to Redis list to notify job completion
var delay=Math.random()*3000;
console.log("Delay:", delay);
setTimeout(function() {
    rcl.rpush(taskId, "OK", function(err, reply) {
        if (err) {
		console.err("Redis notification failed in handler.");
		throw err;
	} else {
	    process.exit(0);
	}
    });
}, delay);

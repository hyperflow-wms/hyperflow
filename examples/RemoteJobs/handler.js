// Executor of 'jobs' using the Redis task status notification mechanism
var redis = require('redis');

if (process.argv.length < 4) {
  console.error("Usage: node handler.js <taskId> <redis_url>");
  process.exit(1);
}

// 'taskId' is the name of the Redis list to use for the notification
var taskId = process.argv[2],
redis_url = process.argv[3];

//console.log("taskId", taskId);
//console.log("redis_url", redis_url);

var rcl = redis.createClient(redis_url);

// get job message from Redis 
var getJobMessage = async function (timeout) {
    return new Promise(function (resolve, reject) {
        const jobMsgKey = taskId + "_msg";
        rcl.brpop(jobMsgKey, timeout, function (err, reply) {
            err ? reject(err): resolve(reply)
        });
    });
}

// send notification about job completion to Redis
var notifyJobCompletion = async function () {
    return new Promise(function (resolve, reject) {
        rcl.rpush(taskId, "OK", function (err, reply) {
            err ? reject(err): resolve(reply)
        });
    });
}


async function executeJob() {

    // 1. get job message
    try {
        var jobMessage = await getJobMessage(10);
    } catch (err) {
        console.error(err);
        throw err;
    }
    console.log("Received job message:", jobMessage);

    // 2. HERE the job would be executed

    // 3. Notify job completion (delay simulates execution time)
    var delay = Math.random() * 3000;
    // console.log("Delay:", delay);
    setTimeout(async function () {
        try {
            await notifyJobCompletion();
        } catch (err) {
            console.error("Redis notification failed", err);
            throw err;
        }

        process.exit(0);
    }, delay);
}

executeJob()

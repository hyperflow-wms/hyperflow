var spawn = require('child_process').spawn;

// Spawns a job "node handler.js" and waits for the notification of its
// completion using the Redis job status notification mechanism
async function job_status_redis_test(ins, outs, context, cb) {
  var n = Number(ins.number.data[0]);

  //console.log("Spawning process...");

  const executable = context.executor.executable;
  let jobMessage = JSON.stringify({
        "executable": executable,
        "args": context.executor.args,
        "env": (context.executor.env || {}),
        "inputs": ins.map(i => i),
        "outputs": outs.map(o => o),
        "stdout": context.executor.stdout, // if present, denotes file name to which stdout should be redirected
      	"redis_url": context.redis_url,
      	"taskId": context.taskId
  });

  // "submit" job (start the handler process)
  var proc = spawn('node', ['handler.js', context.taskId, context.redis_url], {shell: true});

  proc.stderr.on('data', function(data) {
    console.log(data.toString());
  });

  proc.stdout.on('data', function(data) {
    console.log(data.toString());
  });

  proc.on('exit', function(code) {
    //console.log('Process exited with code', code);
  });

  // send message to the job (command to be executed)
  try {
      await context.sendMsgToJob(jobMessage);
  } catch(err) {
      console.error(err);
      throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await context.jobResult(0);
    console.log('Received job result:', jobResult);
    setTimeout(function() {
      cb(null, outs);
    }, 5000);
  } catch(err) {
    console.error(err);
    throw err;
  }
}

exports.job_status_redis_test = job_status_redis_test;

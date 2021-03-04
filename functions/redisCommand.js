// Executes workflow tasks as local processes "node handler.js" and communicates 
// with them through Redis. In addition, if 'container' is defined, runs via Docker

var spawn = require('child_process').spawn;
var log4js = require('log4js');
var createJobMessage = require('../common/jobMessage.js').createJobMessage;

// limit of parallel jobs
const MAX_PARALLELISM = process.env.HF_VAR_REDIS_CMD_MAX_PARALLELISM || 10;
// how long to sleep in the case max parallelism is achieved
const WAIT_TIME_MS = process.env.HF_VAR_REDIS_CMD_WAIT_TIME_MS || 2000;

// number of jobs currently running
var numParallelJobs = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function redisCommand(ins, outs, context, cb) {
  let fname='wftrace-' + context.hfId + '-' + context.appId + '.log';
  log4js.configure({
    appenders: { hftrace: { type: 'file', filename: fname } },
    categories: { default: { appenders: ['hftrace'], level: 'error' } }
  });

  var logger = log4js.getLogger();

  logger.level = 'error';

  var input_dir = context.executor.input_dir,
      work_dir = context.executor.work_dir,
      output_dir = context.executor.output_dir;
    
  let jobMessage = JSON.stringify(createJobMessage(ins, outs, context));

  // environment variables override 'container' and 'work_dir' settings
  if (process.env.HF_VAR_WORKER_CONTAINER) {
    context.container=process.env.HF_VAR_WORKER_CONTAINER;   
  }
  if (process.env.HF_VAR_WORK_DIR) {
    work_dir=process.env.HF_VAR_WORK_DIR;
  }

  var cmd;
  // if 'container' is present, run through Docker, mounting all directories if necessary
  if (!work_dir) { work_dir=process.cwd; }
  if (context.container) {
    cmd = 'docker run --network container:redis --name ' + context.name + "_" + context.taskId.replace(/:/g, '_');
    if (input_dir) cmd += ' -v ' + input_dir + ':/input_dir ';
    if (work_dir) cmd += ' -v ' + work_dir + ':/work_dir ';
    if (output_dir) cmd += ' -v ' + output_dir + ':/output_dir ';
    cmd += context.container + ' hflow-job-execute';
  } else cmd = 'hflow-job-execute'

  try {
    // if hyperflow also runs in container, chdir doesn't make sense
    if (work_dir && !process.env.HF_VAR_HFLOW_IN_CONTAINER) { process.chdir(work_dir); }
  } catch (error) {
    throw error;
  }

  // Wait in the case max parallelism is achieved
  while (numParallelJobs == MAX_PARALLELISM) {
    console.log("Max parallelism acheived, sleeping", WAIT_TIME_MS + "ms...")
    await sleep(WAIT_TIME_MS);
  }

  numParallelJobs++;
  console.log("Jobs currently running:", numParallelJobs);
  console.log("Spawning:", cmd, '--', context.taskId, context.redis_url);

  // "submit" job (start the handler process)
  var proc = spawn(cmd, [context.taskId, context.redis_url], {shell: true});

  proc.stderr.on('data', function(data) {
    logger.debug(data.toString());
    console.error(data.toString());
  });

  proc.stdout.on('data', function(data) {
    logger.debug(data.toString());
    console.log(data.toString());
  });

  proc.on('exit', function(code) {
    logger.debug('Process exited with code', code);
  });

  // send message to the job (command to be executed)
  try {
    await context.sendMsgToJob(jobMessage);
    logger.info('[' + context.taskId + '] job message sent');
  } catch(err) {
    console.error(err);
    throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await context.jobResult(0);
    logger.info('[' + context.taskId + '] job result received:', jobResult);
    console.log('Received job result:', jobResult);
    numParallelJobs--;
    cb(null, outs);
  } catch(err) {
    console.error(err);
    throw err;
  }
}

exports.redisCommand = redisCommand;

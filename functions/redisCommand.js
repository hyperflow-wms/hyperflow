// Executes workflow tasks as local processes "node handler.js" and communicates 
// with them through Redis. In addition, if 'container' is defined, runs via Docker

var spawn = require('child_process').spawn;
var log4js = require('log4js');
var createJobMessage = require('../common/jobMessage.js').createJobMessage;
var os = require('os');
var clog = require('../common/consoleLogger');

// Used to run worker containers as local user (should be set in the Hyperflow container)
const uid = process.env.USER_ID;
const gid = process.env.USER_GID;

// limit of parallel jobs
const MAX_PARALLELISM = process.env.HF_VAR_REDIS_CMD_MAX_PARALLELISM || 10;
// how long to sleep in the case max parallelism is achieved
const WAIT_TIME_MS = process.env.HF_VAR_REDIS_CMD_WAIT_TIME_MS || 2000;

// number of jobs currently running
var numParallelJobs = 0;

// warn about missing UID/GID mapping once per engine process, not per task
var warnedNoUidGid = false;

// set host name to be logged by the executor
process.env.HF_LOG_NODE_NAME = os.hostname();

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
    cmd = 'docker run --network hyperflow-net --name ' + context.name + "_" + context.taskId.replace(/:/g, '_');
    if (input_dir) cmd += ' -v ' + input_dir + ':/input_dir ';
    if (work_dir) cmd += ' -v ' + work_dir + ':/work_dir ';
    if (output_dir) cmd += ' -v ' + output_dir + ':/output_dir ';
    if (uid && gid) {
      cmd += ` --user ${uid}:${gid}`;
    } else if (!warnedNoUidGid) {
      warnedNoUidGid = true;
      clog.warn("HOST_UID/HOST_GID not set - running job containers as default user");
    }
    cmd += ' -e HF_LOG_NODE_NAME="' + os.hostname() + '" ';
    cmd += ' -e HF_VAR_CONSOLE_LOG_LEVEL="' + (process.env.HF_VAR_CONSOLE_LOG_LEVEL || 'info') + '" ';
    // file-log level for the executor's per-task trace, when set
    if (process.env.HF_VAR_LOG_LEVEL) {
      cmd += ' -e HF_VAR_LOG_LEVEL="' + process.env.HF_VAR_LOG_LEVEL + '" ';
    }
    // color preference, so worker output matches the engine's. Never pass both:
    // node warns that it is ignoring one of them.
    if (process.env.NO_COLOR) {
      cmd += ' -e NO_COLOR="' + process.env.NO_COLOR + '" ';
    } else if (process.env.FORCE_COLOR) {
      cmd += ' -e FORCE_COLOR="' + process.env.FORCE_COLOR + '" ';
    }
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
    clog.debug("Max parallelism achieved, sleeping", WAIT_TIME_MS + "ms...")
    await sleep(WAIT_TIME_MS);
  }

  numParallelJobs++;
  // monotonic: the wall clock can step backwards and make short jobs report a
  // negative duration
  const startTime = performance.now();
  const c = clog.color;
  clog.info(c.dim('[hf] task'), c.started('started:'), c.task(context.name),
            c.dim('(' + context.taskId + ')'),
            c.dim('[' + numParallelJobs + ' running]'));
  clog.debug("Spawning:", cmd, '--', context.taskId, context.redis_url);

  // "submit" job (start the handler process)
  var proc = spawn(cmd, [context.taskId, context.redis_url], {shell: true});

  proc.stderr.on('data', function(data) {
    logger.debug(data.toString());
    clog.warn(c.warn('[worker ' + context.name + ']'), data.toString().trimEnd());
  });

  proc.stdout.on('data', function(data) {
    logger.debug(data.toString());
    clog.debug(data.toString().trimEnd());
  });

  proc.on('exit', function(code) {
    logger.debug('Process exited with code', code);
  });

  // send message to the job (command to be executed)
  try {
    await context.sendMsgToJob(jobMessage);
    logger.info('[' + context.taskId + '] job message sent');
  } catch(err) {
    clog.error(err);
    throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await context.jobResult(0);
    logger.info('[' + context.taskId + '] job result received:', jobResult);
    numParallelJobs--;
    const failed = String(jobResult[1]) !== '0';
    clog.info(c.dim('[hf] task'),
              failed ? c.failed('failed:') : c.finished('finished:'),
              c.task(context.name), c.dim('(' + context.taskId + ')'),
              failed ? c.failed('exit=' + jobResult[1]) : c.dim('exit=0'),
              c.time('time=' + ((performance.now() - startTime) / 1000).toFixed(1) + 's'),
              c.dim('[' + numParallelJobs + ' running]'));
    clog.debug('Received job result:', jobResult);
    cb(null, outs);
  } catch(err) {
    clog.error(err);
    throw err;
  }
}

exports.redisCommand = redisCommand;

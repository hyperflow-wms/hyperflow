const tracer = process.env.HF_VAR_ENABLE_TRACING === "1" ? require("../../tracing.js")("hyperflow-service") : undefined;
var spawn = require('child_process').spawn;
var log4js = require('log4js');
var createJobMessage = require('../../common/jobMessage.js').createJobMessage;


// Spawns a job "node handler.js" and waits for the notification of its
// completion using the Redis job status notification mechanism
async function submitRemoteJob(ins, outs, context, cb) {

  let jobMessage = JSON.stringify(createJobMessage(ins, outs, context));

  let fname = 'wftrace-' + context.hfId + '-' + context.appId + '.log';

  log4js.configure({
    appenders: {hftrace: {type: 'file', filename: fname}},
    categories: {default: {appenders: ['hftrace'], level: 'error'}}
  });

  var logger = log4js.getLogger();

  logger.level = 'debug';
  console.log("Spawning process...");

  function runJob(trace_id = undefined, parent_id = undefined, span = undefined) {
    var input_dir = context.executor.input_dir,
      work_dir = context.executor.work_dir,
      output_dir = context.executor.output_dir;

    var cmd;

    // if 'container' is present, run through Docker, mounting all directories if necessary
    if (context.container) {
      cmd = 'docker run ';
      if (input_dir) cmd += ' -v ' + input_dir + ':/input_dir ';
      if (work_dir) cmd += ' -v ' + work_dir + ':/work_dir ';
      if (output_dir) cmd += ' -v ' + output_dir + ':/output_dir ';
      cmd += container + ' node';
    } else cmd = 'node'

    try {
      if (work_dir) {
        process.chdir(work_dir);
      }
    } catch (error) {
      throw error;
    }

    // "submit" job (start the handler process)
    var proc = spawn(cmd, ['../../../hyperflow-job-executor/jobexec.js', context.taskId, context.redis_url],
        {shell: true, env: {...process.env, HF_VAR_OT_PARENT_ID: parent_id, HF_VAR_OT_TRACE_ID: trace_id,
            HF_VAR_ENABLE_TRACING: process.env.HF_VAR_ENABLE_TRACING}});

    if (span !== undefined && span.isRecording()) {
      span.setAttributes({
        'hfId': context.hfId, 'appId': context.appId, 'input_dir': input_dir,
        'work_dir': work_dir, 'output_dir': output_dir
      })
    }

    proc.stderr.on('data', function (data) {
      logger.debug(data.toString());
      console.log(data.toString());
    });

    proc.stdout.on('data', function (data) {
      logger.debug(data.toString());
      console.log(data.toString());
    });

    proc.on('exit', function (code) {
      logger.debug('Process exited with code', code);
    });
  }

  if (process.env.HF_VAR_ENABLE_TRACING === "1") {
    tracer.startActiveSpan('submitRemoteJob', span => {
      //console.log(ins.map(i => i));
      var trace_id = span.spanContext().traceId
      var parent_id = span.spanContext().spanId
      runJob(trace_id, parent_id, span)
      span.end();
    });
  } else {
    runJob()
  }

  // send message to the job (command to be executed)
  try {
    await context.sendMsgToJob(jobMessage, context.taskId);
    logger.info('[' + context.taskId + '] job message sent');
  } catch (err) {
    console.error(err);
    throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await context.jobResult(0, context.taskId);
    logger.info('[' + context.taskId + '] job result received:', jobResult);
    console.log('Received job result:', jobResult);
    cb(null, outs);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

exports.submitRemoteJob = submitRemoteJob;
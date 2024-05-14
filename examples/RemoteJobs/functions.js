var spawn = require('child_process').spawn;
var log4js = require('log4js');
var createJobMessage = require('../../common/jobMessage.js').createJobMessage;

"use strict";

const aws = require("aws-sdk");
const s3 = new aws.S3();
const ecs = new aws.ECS({region: 'us-east-1'}); // aws sdk doesn't load region by default
const maxRetryWait = 10 * 60 * 1000; // 10 minutes
const minRetryWait = 0;
let runningTasks = 0;

async function awsFargateCommand(ins, outs, config, cb) {

    while (runningTasks >= 50) { // AWS Fargate supports up to 50 instances at a given time
        await sleep(3000);
    }
    runningTasks++;

    const executor_config = await getConfig(config.workdir);

    const options = executor_config.options;
    if (config.executor.hasOwnProperty("options")) {
        let executorOptions = config.executor.options;
        for (let opt in executorOptions) {
            if (executorOptions.hasOwnProperty(opt)) {
                options[opt] = executorOptions[opt];
            }
        }
    }

    const randomString = (Math.random() * 1e12).toString(36);

    let logName;
    if (executor_config.metrics) {
        logName = "log_" + randomString;
    }

    const executable = config.executor.executable;
    let jobMessage = JSON.stringify({
        "executable": executable,
        "args": config.executor.args,
        "env": (config.executor.env || {}),
        "inputs": ins.map(i => i),
        "outputs": outs.map(o => o),
        "options": options,
        "stdout": config.executor.stdout,
        "logName": logName
    });

    console.log("Executing: " + jobMessage + " on AWS Fargate");

    if (jobMessage.length > 8192) { // if payload is bigger than 8192 bytes (npm argument size limit), it is send via S3
        const fileName = "config_" + randomString;
        const fileContent = jobMessage;
        const uploadParams = {
            Bucket: options.bucket,
            Key: "tmp/" + fileName,
            ContentType: 'text/plain',
            Body: fileContent
        };
        const downloadParams = {
            Bucket: options.bucket,
            Key: "tmp/" + fileName
        };
        jobMessage = "S3=" + JSON.stringify(downloadParams);
        await s3.putObject(uploadParams).promise();
    }

    const runTaskWithRetryStrategy = (times) => new Promise(() => {
        return runTask()
            .catch(error => {
                if (["ThrottlingException", "NetworkingError", "TaskLimitError"].includes(error.name)) {
                    console.log("Fargate runTask method threw " + error.name + ", performing retry number " + (times + 1));
                    return backoffWait(times)
                        .then(runTaskWithRetryStrategy.bind(null, times + 1));
                }
                console.log("Running fargate task " + executable + " failed after " + times + " retries, error: " + error);
            });
    });

    await runTaskWithRetryStrategy(0);

    async function getConfig(workdir) {
        let config;
        try {
            config = require(workdir + "/awsFargateCommand.config.js");
        } catch (e) {
            console.log("No config in " + workdir + ", loading config from default location: .");
            config = require("./awsFargateCommand.config.js");
        }
        return config;
    }

    async function runTask() {
        const fireTime = Date.now();
        await ecs.runTask(await createFargateTask()).promise().then(async function (data) {
            if (data.failures && data.failures.map(failure => failure.reason).includes("You\'ve reached the limit on the number of tasks you can run concurrently")) {
                throw new TaskLimitError()
            }
            let taskArn = data.tasks[0].taskArn;
            let containerStatusCode = await waitAndGetExitCode(taskArn);
            if (containerStatusCode !== 0) {
                console.log("Error: container returned non-zero exit code: " + containerStatusCode + " for task " + executable + " with arn: " + taskArn);
                return
            }
            const params = {
                Bucket: options.bucket,
                Key: "logs/" + logName
            };
            console.log("Fargate task: " + config.name + " with arn: " + taskArn + " completed successfully.");
            if (executor_config.metrics) {
                const log = await s3.getObject(params).promise().then(data => data.Body.toString());
                console.log("Metrics: task: " + config.name + " fire time " + fireTime + " " + log);
            }
            runningTasks--;
            cb(null, outs);
        });
    }

    async function backoffWait(times) {
        let backoffTimes = Math.pow(2, times);
        let backoffWaitTime = Math.floor(Math.random() * backoffTimes) * 500;
        if (backoffWaitTime > maxRetryWait) {
            backoffWaitTime = maxRetryWait;
        }
        if (backoffWaitTime < minRetryWait) {
            backoffWaitTime = minRetryWait;
        }
        console.log("Waiting for " + backoffWaitTime + " milliseconds.");
        return new Promise(resolve => setTimeout(resolve, backoffWaitTime));
    }

    async function createFargateTask() {
        let taskDef = await getTaskDefinition();
        let taskContainer = await getTaskContainer(taskDef);
        return {
            taskDefinition: taskDef,
            cluster: executor_config.cluster_arn,
            count: 1,
            enableECSManagedTags: false,
            launchType: "FARGATE",
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: [executor_config.subnet_1, executor_config.subnet_2],
                    assignPublicIp: "ENABLED",
                    securityGroups: []
                }
            },
            "overrides": {
                "containerOverrides": [
                    {
                        "command": ["npm", "start", jobMessage],
                        "name": taskContainer
                    }
                ]
            },
            platformVersion: "LATEST",
            startedBy: "hyperflow"
        };
    }

    async function getTaskDefinition() {
        const mapping = executor_config.tasks_mapping;
        if (mapping === undefined) {
            let errorMessage = "Missing tasks_mapping in config";
            console.log(errorMessage);
            return
        }
        let taskDefinition = mapping[executable] === undefined ? mapping["default"] : mapping[executable];
        if (taskDefinition === undefined) {
            let errorMessage = "No task tasks_mapping nor default tasks_mapping is defined for " + executable;
            console.log(errorMessage);
            return
        }
        return taskDefinition;
    }

    async function getTaskContainer(taskDefinition) {
        console.warn("task definition: ",taskDefinition)
        let task = await ecs.describeTaskDefinition({taskDefinition}).promise();
        console.warn("task: ",task)
        return task.taskDefinition.containerDefinitions[0].name;
    }

    async function waitAndGetExitCode(taskArn) {
        const payload = {
            tasks: [taskArn],
            cluster: executor_config.cluster_arn
        };
        let taskList = await ecs.describeTasks(payload).promise();
        while (taskList.tasks[0].lastStatus !== "STOPPED") {
            await sleep(5000);
            taskList = await ecs.describeTasks(payload).promise();
        }
        return taskList.tasks[0].containers[0].exitCode;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class TaskLimitError extends Error {
    constructor() {
        super();
        this.name = "TaskLimitError";
    }
}

exports.awsFargateCommand = awsFargateCommand;

// Spawns a job "node handler.js" and waits for the notification of its
// completion using the Redis job status notification mechanism
async function submitRemoteJob(ins, outs, context, cb) {
  let fname='wftrace-' + context.hfId + '-' + context.appId + '.log';
  log4js.configure({
    appenders: { hftrace: { type: 'file', filename: fname } },
    categories: { default: { appenders: ['hftrace'], level: 'error' } }
  });

  var logger = log4js.getLogger();

  logger.level = 'debug';
  console.log("Spawning process...");

  //console.log(ins.map(i => i));

  var input_dir = context.executor.input_dir,
      work_dir = context.executor.work_dir,
      output_dir = context.executor.output_dir;
    
  let jobMessage = JSON.stringify(createJobMessage(ins, outs, context));

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
    if (work_dir) { process.chdir(work_dir); }
  } catch (error) {
    throw error;
  }

  // "submit" job (start the handler process)
  var proc = spawn(cmd, ['../../../hyperflow-job-executor/jobexec.js', context.taskId, context.redis_url], {shell: true});

  proc.stderr.on('data', function(data) {
    logger.debug(data.toString());
    console.log(data.toString());
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
    await context.sendMsgToJob(jobMessage, context.taskId);
    logger.info('[' + context.taskId + '] job message sent');
  } catch(err) {
    console.error(err);
    throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await context.jobResult(0, context.taskId);
    logger.info('[' + context.taskId + '] job result received:', jobResult);
    console.log('Received job result:', jobResult);
    cb(null, outs);
  } catch(err) {
    console.error(err);
    throw err;
  }
}

exports.submitRemoteJob = submitRemoteJob;

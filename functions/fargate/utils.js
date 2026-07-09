const { S3, ECS } = require("aws-sdk");

const ecs = new ECS({ region: "us-east-1" }); // aws sdk doesn't load region by default
const s3 = new S3();

const maxRetryWait = 10 * 60 * 1000; // 10 minutes
const minRetryWait = 0;
let tasks_completed = 0;
let tasks_failed = 0;
let tasks_retry = 0;
let start_errors = 0;

// Using token bucket to avoid rate limiting errors
class TokenBucket {
  constructor(capacity, fillPerSecond) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.taken = 0;
    setInterval(() => this.addToken(), 1000 / fillPerSecond);
  }

  addToken() {
    if (this.tokens < this.capacity) {
      this.tokens += 1;
    }
  }

  take() {
    if (this.tokens > 0) {
      this.tokens -= 1;
      this.taken += 1;
      return true;
    }

    return false;
  }
}

class TaskLimitError extends Error {
  constructor() {
    super();
    this.name = "TaskLimitError";
  }
}

// Error messages for throttling exceptions
const FAILURE_LIMIT_EXCEEDED = [
  "You’ve reached the limit on the number of tasks you can run concurrently",
  "You’ve reached the limit on the number of vCPUs you can run concurrently",
];

const bucket = new TokenBucket(100, 2);

async function runTask(jobMessage, config) {
  console.log(
    `[LOG] ${config.taskId.replace(/:/g, "__")} - ${Date.now()} - ${
      config.executor.executable
    } - RunTask`
  );

  await ecs
    .runTask(await createFargateTask(jobMessage, config))
    .promise()
    .then(async function (data) {
      if (!data.failures || data.failures.length === 0) {
        console.log(
          `[LOG] ${config.taskId.replace(/:/g, "__")} - ${Date.now()} - ${
            config.executor.executable
          } - StartTask`
        );
      }
      if (
        data.failures &&
        data.failures
          .map((failure) => FAILURE_LIMIT_EXCEEDED.includes(failure.reason))
          .some((x) => x)
      ) {
        console.log("Error: " + data.failures[0].reason);
        console.log("vCPU_USED: " + vCPU_used);
        throw new TaskLimitError();
      } else if (data.failures && data.failures.length > 0) {
        start_errors++;
        console.log("Error: ", data.failures[0]);
      }

      let taskArn = data.tasks[0].taskArn;
      let containerStatusCode = await waitAndGetExitCode(taskArn, config);
      console.log(
        `[LOG] ${config.taskId.replace(/:/g, "__")} - ${Date.now()} - ${
          config.executor.executable
        } - TaskFinish`
      );
      if (containerStatusCode !== 0) {
        console.log(
          "Error: container returned non-zero exit code: " +
            containerStatusCode +
            " for task " +
            config.executor.executable +
            " with arn: " +
            taskArn
        );
        tasks_failed++;
        return;
      }
      console.log(
        "Fargate task: " +
          config.name +
          " with arn: " +
          taskArn +
          " completed successfully."
      );
      tasks_completed++;
      console.log(
        "Tasks completed: " + tasks_completed,
        " Tasks running: " + runningTasks,
        " Tasks failed: " + tasks_failed,
        " Tasks retried: " + tasks_retry,
        " Start errors: " + start_errors
      );
      vCPU_used -= parseInt(data.tasks[0].cpu);

      runningTasks--;
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
  return new Promise((resolve) => setTimeout(resolve, backoffWaitTime));
}

async function createFargateTask(jobMessage, config) {
  const executor_config = await getConfig(config.workdir);

  let taskDef = await getTaskDefinition(config);
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
        securityGroups: [],
      },
    },
    overrides: {
      containerOverrides: [
        {
          command: ["npm", "start", jobMessage],
          name: taskContainer,
        },
      ],
    },
    platformVersion: "LATEST",
    startedBy: "hyperflow",
  };
}

async function getTaskDefinition(config) {
  const executor_config = await getConfig(config.workdir);
  const executable = config.executor.executable;
  const mapping = executor_config.tasks_mapping;
  if (mapping === undefined) {
    let errorMessage = "Missing tasks_mapping in config";
    console.log(errorMessage);
    return;
  }
  let taskDefinition =
    mapping[executable] === undefined
      ? mapping["default"]
      : mapping[executable];
  if (taskDefinition === undefined) {
    let errorMessage =
      "No task tasks_mapping nor default tasks_mapping is defined for " +
      executable;
    console.log(errorMessage);
    return;
  }
  return taskDefinition;
}

async function getTaskContainer(taskDefinition) {
  let task = await ecs.describeTaskDefinition({ taskDefinition }).promise();
  return task.taskDefinition.containerDefinitions[0].name;
}

async function waitAndGetExitCode(taskArn, config) {
  const executor_config = await getConfig(config.workdir);

  const payload = {
    tasks: [taskArn],
    cluster: executor_config.cluster_arn,
  };
  let taskList = await ecs.describeTasks(payload).promise();
  while (taskList.tasks[0].lastStatus !== "STOPPED") {
    await sleep(5000);
    taskList = await ecs.describeTasks(payload).promise();
  }
  return taskList.tasks[0].containers[0].exitCode;
}

async function getConfig(workdir) {
  let config;
  try {
    config = require(workdir + "/awsFargateCommand.config.js");
  } catch (e) {
    console.log(
      "No config in " + workdir + ", loading config from default location: ."
    );
    config = require("./awsFargateCommand.config.js");
  }
  return config;
}

async function getJobMessage(ins, outs, config) {
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
    executable: executable,
    args: config.executor.args,
    env: config.executor.env || { nodeName: "fargateNode" },
    inputs: ins.map((i) => i),
    outputs: outs.map((o) => o),
    options: options,
    stdout: config.executor.stdout,
    logName: logName,
    taskId: config.taskId,
    name: config.name,
  });

  if (jobMessage.length > 6800) {
    // if payload is bigger than 8192 bytes (npm argument size limit), it is send via S3
    const fileName = "config_" + randomString;
    const fileContent = jobMessage;
    const uploadParams = {
      Bucket: options.bucket,
      Key: "tmp/" + fileName,
      ContentType: "text/plain",
      Body: fileContent,
    };
    const downloadParams = {
      Bucket: options.bucket,
      Key: "tmp/" + fileName,
    };
    jobMessage = "S3=" + JSON.stringify(downloadParams);
    await s3.putObject(uploadParams).promise();
  }

  return jobMessage;
}

async function runTaskWithRetryStrategy(times, jobMessages, config) {
  try {
    while (!bucket.take()) {
      await sleep(100 + Math.floor(Math.random() * 200));
    }
    await runTask(jobMessages, config);
  } catch (error) {
    if (
      [
        "ThrottlingException",
        "NetworkingError",
        "TaskLimitError",
        "ThrottlingException: Rate exceeded",
      ].includes(error.name)
    ) {
      console.log(
        "Fargate runTask method threw " +
          error.name +
          ", performing retry number " +
          (times + 1)
      );
      await backoffWait(times);
      tasks_retry++;
      await runTaskWithRetryStrategy(times + 1, jobMessages, config);
    } else {
      console.log(
        "Unexpected error - Running fargate task " +
          config.executor.executable +
          " failed after " +
          times +
          " retries, error: " +
          error
      );
      start_errors++;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  runTaskWithRetryStrategy,
  getJobMessage,
  getConfig,
  sleep,
};

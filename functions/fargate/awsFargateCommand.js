const { BufferManager } = require("../buffer_utils/buffer_manager.js");
const {
  getJobMessage,
  runTaskWithRetryStrategy,
  getConfig,
  sleep,
} = require("./utils.js");
const { S3 } = require("aws-sdk");

const s3 = new S3();

let runningTasks = 0;
let vCPU_LIMIT = -1; // Can be set to a value to limit the number of concurrent vCPUs used, -1 means no limit
let vCPU_used = 0;

let bufferManager = new BufferManager();
bufferManager.setCallback((items) => fargateCommandGroup(items));

async function awsFargateCommand(ins, outs, config, cb) {
  const buffersConf = config.appConfig.jobAgglomerations;
  let alreadyConfigured = bufferManager.isConfigured();
  if (alreadyConfigured == false && buffersConf != undefined) {
    bufferManager.configure(buffersConf);
  }

  let item = {
    ins: ins,
    outs: outs,
    context: config,
    cb: cb,
  };

  let partition = config.executor.partition || undefined;
  bufferManager.addItem(config.name, item, partition);
}

async function fargateCommandGroup(bufferItems) {
  if (bufferItems.length == 0) {
    return;
  }

  let jobArr = [];
  let taskIdArr = [];
  let contextArr = [];
  let cbArr = [];

  for (let i = 0; i < bufferItems.length; i++) {
    const { context, ins, outs, cb } = bufferItems[i];
    const { name, executor, taskId } = context;

    let job = executor;
    job.name = name;
    job.ins = ins;
    job.outs = outs;

    jobArr.push(job);
    taskIdArr.push(taskId);
    contextArr.push(context);
    cbArr.push(cb);
  }

  await submitJobs(jobArr, taskIdArr, contextArr);

  for (let i = 0; i < cbArr.length; i++) {
    let cb = cbArr[i];
    let outs = jobArr[i].outs;
    cb(null, outs);
  }
}

async function submitJobs(jobArr, taskIdArr, contextArr) {
  let jobMessages = [];
  for (let i = 0; i < jobArr.length; i++) {
    let job = jobArr[i];
    let taskId = taskIdArr[i];

    let jobMessage = await getJobMessage(
      job.ins,
      job.outs,
      contextArr[i],
      taskId
    );
    jobMessages.push(jobMessage);
  }

  const config = contextArr[0];

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

  const executable = config.executor.executable;
  const vcpu_mapping = executor_config.vcpu_mapping;
  const task_cpu = vcpu_mapping[executable] ?? vcpu_mapping["default"];

  let fargateJobMessage = JSON.stringify(jobMessages);

  if (fargateJobMessage.length >= 6800) {
    const randomString = (Math.random() * 1e12).toString(36);

    // if payload is bigger than 8192 bytes (npm argument size limit), it is send via S3
    const fileName = "config_" + randomString;
    const fileContent = fargateJobMessage;
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
    fargateJobMessage = "S3=" + JSON.stringify(downloadParams);
    await s3.putObject(uploadParams).promise();
  }

  if (vCPU_LIMIT > -1) {
    while (vCPU_used + task_cpu >= vCPU_LIMIT) {
      await sleep(1000 + Math.floor(Math.random() * 3000));
    }
    vCPU_used += task_cpu;
  }

  runningTasks++;

  if (fargateJobMessage.length >= 6800) {
    console.log("fargateJobMessage: ", fargateJobMessage);
  }
  await runTaskWithRetryStrategy(0, fargateJobMessage, config);
}

function exit() {
  console.log("Exiting...");
  process.exit(0);
}

exports.awsFargateCommand = awsFargateCommand;
exports.exit = exit;

// Runs a job as a Pod (deployment) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
var fs = require('fs');
// var getGCPToken = require('./_gcptoken.js');
// var getCluster = require('./_cluster.js');

const CLUSTER_ZONE = 'europe-west2-a';
const CLUSTER_NAME = 'standard-cluster-1';

async function k8sCommand(ins, outs, context, cb) {

  let handlerStart = Date.now();
  console.log("[DEBUG] K8sInvoke called.");
  // let cluster = await getCluster();
  // const token = await getGCPToken();

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  const k8sApi = kc.makeApiClient(k8s.BatchV1Api);
  try {
    var command = 'hflow-job-execute ' + context.taskId + ' ' + context.redis_url;
    var containerName = process.env.HF_VAR_WORKER_CONTAINER;
    var volumePath = '/work_dir';
    var jobName = Math.random().toString(36).substring(7);

    // Load definition of the the worker job pod
    // Note that the file 'job-template.yaml' should be provided 
    // externally, e.g. mounted
    var jobYaml = fs.readFileSync('./job-template.yaml', 'utf8');
    var job = yaml.safeLoad(eval('`'+jobYaml+'`'));

    var namespace = 'default';

    let taskStart = Date.now();
    console.log("Staring task", taskStart);

    k8sApi.createNamespacedJob(namespace, job).then(
      (response) => {
      },
      (err) => {
        console.log(err);
        console.log(job);
        console.log("Err");
        let taskEnd = Date.now();
        console.log("Task ended with error", taskEnd);
      },
    );

  } catch (e) {
    console.error(e);
  }

  // send message to the job (command to be executed)
  let jobMessage = JSON.stringify({
    "executable": context.executor.executable,
    "args": [].concat(context.executor.args),
    // "env": context.executor.env || {},
    "inputs": ins.map(i => i),
    "outputs": outs.map(o => o),
    "stdout": context.executor.stdout, // if present, denotes file name to which stdout should be redirected
    "redis_url": context.redis_url,
    "taskId": context.taskId,
    "name": context.name
  });
  try {
    await context.sendMsgToJob(jobMessage);
  } catch (err) {
    console.error(err);
    throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await context.jobResult(0);
    let taskEnd = Date.now();
    console.log('Job ended with result:', jobResult);
    cb(null, outs);
  } catch (err) {
    console.error(err);
    throw err;
  }

  let handlerEnd = Date.now();
  console.log("Ending handler", handlerEnd);
}

exports.k8sCommand = k8sCommand;

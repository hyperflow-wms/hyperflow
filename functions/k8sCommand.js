// Runs a job as a Pod (deployment) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
// var getGCPToken = require('./_gcptoken.js');
// var getCluster = require('./_cluster.js');

const CLUSTER_ZONE = 'europe-west2-a';
const CLUSTER_NAME = 'standard-cluster-1';

async function k8sCommand(ins, outs, config, cb) {

  let handlerStart = Date.now();
  console.log("[DEBUG] K8sInvoke called.");
  // let cluster = await getCluster();
  // const token = await getGCPToken();

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  const k8sApi = kc.makeApiClient(k8s.BatchV1Api);
  try {
    var command = 'hflow-job-execute ' + config.taskId + ' ' + config.redis_url;
    var containerName = process.env.HF_VAR_WORKER_CONTAINER;
    var volumePath = '/work_dir';
    var jobName = Math.random().toString(36).substring(7);
    var job = yaml.safeLoad(`apiVersion: batch/v1
kind: Job
metadata:
  name: job${jobName}
spec:
  template:
    spec:
      containers:
      - name: test
        image: ${containerName}
        command:
          - "/bin/sh"
          - "-c"
          - >
            ${command};
        workingDir: ${volumePath}
        resources:
          requests:
            cpu: "1m"
        volumeMounts:
        - name: my-pvc-nfs
          mountPath: ${volumePath}
      restartPolicy: Never
      volumes:
      - name: workflow-data
        emptyDir: {}
      - name: my-pvc-nfs
        persistentVolumeClaim:
          claimName: nfs`);
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
    "executable": config.executor.executable,
    "args": [].concat(config.executor.args),
    // "env": config.executor.env || {},
    "inputs": ins.map(i => i),
    "outputs": outs.map(o => o),
    "stdout": config.executor.stdout, // if present, denotes file name to which stdout should be redirected
    "redis_url": config.redis_url,
    "taskId": config.taskId
  });
  try {
    await config.sendMsgToJob(jobMessage);
  } catch (err) {
    console.error(err);
    throw err;
  }

  // wait for the job to finish (timeout=0 means indefinite)
  try {
    var jobResult = await config.jobResult(0);
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
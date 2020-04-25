// Runs a job as a Pod (Kubernetes Job) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');

async function k8sCommand(ins, outs, context, cb) {

  let startTime = Date.now();
  console.log("k8sCommand started, time:", startTime);
  // let cluster = await getCluster();
  // const token = await getGCPToken();

  // support for two clusters (cloud bursting) 
  // if 'HF_VAR_REMOTE_CLUSTER' is defined, we check where this job is assigned to:
  // - the local cluster: we do nothing
  // - the remote cluster: we set KUBECONFIG to load its configuration
  var remoteClusterId = process.env.HF_VAR_REMOTE_CLUSTER;
  if (remoteClusterId) {
    let partition = context.executor.partition;
    if (partition == remoteClusterId) {
      // this will cause reading the kube_config of the remote cluster
      process.env.KUBECONFIG = process.env.HF_VAR_KUBE_CONFIG_PATH || "./kube_config";
    }
  }

  const kubeconfig = new k8s.KubeConfig();
  kubeconfig.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  var job = {
    name: context.name,
    executable: context.executor.executable,
    args: context.executor.args,
    stdout: context.executor.stdout, // optional file name to which stdout should be redirected
    ins: ins,
    outs: outs
  }

  if (context.executor.image) { job.image = context.executor.image; }

  // custom parameters to the job YAML template (will overwrite default values)
  var customParams = {};

  let jobExitCode = await submitK8sJob(kubeconfig, job, context.taskId, context, customParams);

  let endTime = Date.now();
  console.log("Ending k8sCommand function, time:", endTime);

  if (jobExitCode != 0) {
    console.log('Error: job exited with error code, stopping workflow.');
    process.exit(1);
  }

  cb(null, outs);
}

exports.k8sCommand = k8sCommand;
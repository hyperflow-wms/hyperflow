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

  var job = context.executor; // object containing 'executable', 'args' and others
  job.name = context.name;
  job.ins = ins;
  job.outs = outs;

  // custom parameters to the job YAML template (will overwrite default values)
  var customParams = {};

  let jobExitCode = await submitK8sJob(kubeconfig, job, context.taskId, context, customParams);

  let endTime = Date.now();
  console.log("Ending k8sCommand function, time:", endTime);

  // Stop the entire workflow if a job fails (controlled by an environment variable)
  if (jobExitCode != 0 && process.env.HF_VAR_STOP_WORKFLOW_WHEN_JOB_FAILED=="1") {
    console.log('Error: job exited with error code, stopping workflow.');
    console.log('Error details: job.name: ' + job.name + ', job.args: ' + job.args.join(' '));
    process.exit(1);
  }

  cb(null, outs);
}

exports.k8sCommand = k8sCommand;
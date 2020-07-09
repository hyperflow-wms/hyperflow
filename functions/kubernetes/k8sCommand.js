// Runs a job as a Pod (Kubernetes Job) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');

async function k8sCommand(ins, outs, context, cb) {

  let startTime = Date.now();
  console.log("k8sCommand started, time:", startTime);
  // let cluster = await getCluster();
  // const token = await getGCPToken();

  // support for two (or more) clusters (for cloud bursting) 
  // if 'partition' is defined, check if there is a custom config file
  // for that partition. This config file may override parameters of the job,
  // possibly even define a path to a different kube_config to be loaded
  let partition = context.executor.partition; 
  let partitionConfigDir = process.env.HF_VAR_PARTITION_CONFIG_DIR || "/opt/hyperflow/partitions";
  let partitionConfigFile = partitionConfigDir + "/" + "part." + partition + ".config.json";

  // custom parameters for the job YAML template (will overwrite default values)
  var customParams = {};
  try {
    // if file exists, all configuration parameters will be read to 'customParams'
    let rawdata = fs.readFileSync(partitionConfigFile);
    customParams = JSON.parse(rawdata);
  } catch {
  }
  console.log(partitionConfigFile);
  console.log("CUSTOM...", customParams);

  // Set kube_config path if overridden 
  if (customParams.kubeConfigPath) {
      process.env.KUBECONFIG = customParams.kubeConfigPath;
      console.log(process.env.KUBECONFIG);
  }

  const kubeconfig = new k8s.KubeConfig();
  kubeconfig.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  var job = context.executor; // object containing 'executable', 'args' and others
  job.name = context.name;
  job.ins = ins;
  job.outs = outs;

  let jobExitCode = await submitK8sJob(kubeconfig, job, context.taskId, context, customParams);

  let endTime = Date.now();
  console.log("Ending k8sCommand function, time:", endTime);

  // Stop the entire workflow if a job fails (controlled by an environment variable)
  if (jobExitCode != 0 && process.env.HF_VAR_STOP_WORKFLOW_WHEN_JOB_FAILED=="1") {
    console.log('Error: job exited with error code, stopping workflow.');
    console.log('Error details: job.name: ' + job.name + ', job.args: ' + job.args.join(' '));
    process.exit(1);
  }

  // if we're here, the job should have succesfully completed -- we write this
  // information to Redis (job executor may make use of it).
  try {
    await context.markTaskCompleted();
  } catch {
    console.error("Marking job", context.taskId, "as completed failed.")
  }
  cb(null, outs);
}

exports.k8sCommand = k8sCommand;

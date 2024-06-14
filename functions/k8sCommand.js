// Runs a job as a Pod (Kubernetes Job) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
var fs = require('fs');

async function k8sCommand(ins, outs, context, cb, parentId, traceId) {

  let handlerStart = Date.now();
  console.log("[DEBUG] K8sInvoke called.");
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

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  const k8sApi = kc.makeApiClient(k8s.BatchV1Api);
  try {
    var command = 'hflow-job-execute ' + context.taskId + ' ' + context.redis_url + ' ' + parentId + ' ' + traceId;
    var containerName = process.env.HF_VAR_WORKER_CONTAINER;
    var volumePath = '/work_dir';
    var jobName = Math.random().toString(36).substring(7) + '-' + context.name.replace(/_/g, '-') + "-" + context.procId;
    jobName = jobName.replace(/[^0-9a-z-]/gi, '').toLowerCase(); // remove chars not allowd in Pod names
    var cpuRequest = context.executor.cpuRequest || process.env.HF_VAR_CPU_REQUEST || "1";
    var memRequest = context.executor.memRequest || process.env.HF_VAR_MEM_REQUEST || "50Mi";

    // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
    var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0; 
    var restartPolicy = backoffLimit > 0 ? "OnFailure": "Never"; 
    var restartCount = 0;

    // Load definition of the the worker job pod
    // File 'job-template.yaml' should be provided externally during deployment
    var job_template_path = process.env.HF_VAR_JOB_TEMPLATE_PATH || "./job-template.yaml";
    var jobYaml = fs.readFileSync(job_template_path, 'utf8');
    //var job = yaml.safeLoad(eval('`'+jobYaml+'`')); // this works, but eval unsafe

    // use string replacement instead of eval to evaluate job template
    // 'params' should contain values for variables to be replaced in job template yaml
    var params = { 
      command: command, containerName: containerName, 
      jobName: jobName, volumePath: volumePath,
      cpuRequest: cpuRequest, memRequest: memRequest,
      restartPolicy: restartPolicy, backoffLimit: backoffLimit,
      experimentId: context.hfId + ":" + context.appId,
      workflowName: context.wfname, taskName: context.name,
      appId: context.appId
    }
    // args[v] will evaluate to 'undefined' if 'v' doesn't exist
    var interpolate = (tpl, args) => tpl.replace(/\${(\w+)}/g, (_, v) => args[v]);
    var job = yaml.safeLoad(interpolate(jobYaml, params));

    var namespace = process.env.HF_VAR_NAMESPACE || 'default';

    let taskStart = Date.now();
    console.log("Starting task", context.taskId, 'time=' + taskStart);

    k8sApi.createNamespacedJob(namespace, job).then(
      (response) => {
      },
      (err) => {
        console.log(err);
        console.log(job);
        console.log("Err");
        let taskEnd = Date.now();
        console.log("Task ended with error, time=", taskEnd);
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
  var awaitJob = async() => {
    try {
      var jobResult = await context.jobResult(0);
      let taskEnd = Date.now();
      console.log('Job ended with result:', jobResult, 'time:', taskEnd);
      var code = parseInt(jobResult[1]);
      if (code==0) { // job succeeded
        cb(null, outs);
      } else { // job failed
        console.log('Job failed, taskId:', context.taskId);
        if (restartPolicy == "OnFailure" && restartCount++ < backoffLimit)  {
          console.log("Waiting again for job's restart (restartCount:", restartCount + ")");
          return awaitJob(); // just wait again assuming Kubernetes will restart the job
        } else {
          console.log('Error: job exited with error code, stopping workflow.');
          process.exit(1);
        }
      }
    } catch (err) {
      console.error(err);
      throw err;
    }
  }
  awaitJob();

  let handlerEnd = Date.now();
  console.log("Ending handler, time:", handlerEnd);
}

exports.k8sCommand = k8sCommand;

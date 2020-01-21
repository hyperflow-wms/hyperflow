// Runs a job as a Pod (Kubernetes Job) in a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
var fs = require('fs');

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
    var jobName = Math.random().toString(36).substring(7) + '-' + context.name.replace(/_/g, '-') + "-" + context.procId;
    jobName = jobName.replace(/[^0-9a-z-]/gi, '').toLowerCase(); // remove chars not allowd in Pod names
    var cpuRequest = context.executor.cpuRequest || "1";

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
      cpuRequest: cpuRequest
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
      if (parseInt(jobResult[1])==0) { // job succeeded
        cb(null, outs);
      } else { // job failed
        console.log('Job failed, waiting again (retry); taskId:', context.taskId)
        return awaitJob(); // wait again; temporary for testing Kubernetes job retry mechanism
        console.log('Error: job exited with error code, stopping workflow.');
        process.exit(1);
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
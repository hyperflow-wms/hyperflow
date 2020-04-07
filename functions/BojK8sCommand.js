// Runs bags-of-jobs on a Kubernetes cluster

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
var fs = require('fs');


// Function createK8sJobSpec
//
// Inputs:
// - 'job': job definition object; it should contain: 
//   * 'executable' and 'args' (usually passed via 'context.executor')
//   * 'ins' and 'outs' (arrays, as passed to the process function)
//   * 'name': job class name (not unique id), usually passed via 'context.name'
// - 'taskId': unique task identifier (use 'context.taskId' or define custom)
// - 'context': pass the 'context' parameter of the process function; 
//    it should contain the 'redis_url', 'hfId', 'appId'
// - 'jobYamlTemplate': job YAML that may contain variables '{{varname}}'
// - 'customParams': JSON object that defines values for variables in the
//   job's YAML template.
// 
// Returns:
// - JSON object with two strings:
//   * jobYaml: job YAML to create the k8s job
//   * jobMessage: job command to be sent to a remote executor
var createK8sJobSpec = (job, taskId, context, jobYamlTemplate, customParams) => {
  var command = 'hflow-job-execute ' + taskId + ' ' + context.redis_url;
  var containerName = process.env.HF_VAR_WORKER_CONTAINER;
  var volumePath = '/work_dir';
  var jobName = Math.random().toString(36).substring(7) + '-' + 
                job.name.replace(/_/g, '-') + "-" + context.procId + '-' + context.firingId;

  // remove chars not allowd in Pod names
  jobName = jobName.replace(/[^0-9a-z-]/gi, '').toLowerCase(); 

  var cpuRequest = job.cpuRequest || process.env.HF_VAR_CPU_REQUEST || "1";
  var memRequest = job.memRequest || process.env.HF_VAR_MEM_REQUEST || "50Mi";

  // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
  var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0; 
  var restartPolicy = backoffLimit > 0 ? "OnFailure": "Never"; 

  var restartCount = 0;

  // use string replacement (instead of eval) to evaluate job template
  // 'params' should contain values for variables to be replaced in job template yaml
  var params = { 
    command: command, containerName: containerName, 
    jobName: jobName, volumePath: volumePath,
    cpuRequest: cpuRequest, memRequest: memRequest,
    restartPolicy: restartPolicy, backoffLimit: backoffLimit,
    experimentId: context.hfId + ":" + context.appId,
    workflowName: context.wfname, taskName: job.name,
    appId: context.appId
  }

  // Add/override custom parameters for the job
  Object.keys(customParams).forEach(function(key) {
    params[key] = customParams[key];
  });

  // args[v] will evaluate to 'undefined' if 'v' doesn't exist
  var interpolate = (tpl, args) => tpl.replace(/\${(\w+)}/g, (_, v) => args[v]);
  var jobYaml = yaml.safeLoad(interpolate(jobYamlTemplate, params));

  // create the job message (command to be executed)
  let jobMessage = {
    "executable": job.executable,
    "args": [].concat(job.args),
    // "env": job.env || {},
    "inputs": job.ins.map(i => i),
    "outputs": job.outs.map(o => o),
    "stdout": job.stdout, // if present, denotes file name to which stdout should be redirected
    "redis_url": context.redis_url,
    "taskId": taskId,
    "name": job.name
  }

  return { jobYaml: jobYaml, jobMessage: jobMessage };
}

// Function submitK8sJob
//
// Inputs: see inputs to 'createK8sJobSpec'
// Returns: job exit code
var submitK8sJob = async(job, taskId, context, customParams) => {
  var command = 'hflow-job-execute ' + taskId + ' ' + context.redis_url;

  // Load definition of the the worker job pod
  // File 'job-template.yaml' should be provided externally during deployment
  var jobTemplatePath = process.env.HF_VAR_JOB_TEMPLATE_PATH || "./job-template.yaml";
  var jobYamlTemplate = fs.readFileSync(jobTemplatePath, 'utf8');
  //var job = yaml.safeLoad(eval('`'+jobYaml+'`')); // this works, but eval unsafe

  var jobSpec = createK8sJobSpec(job, taskId, context, jobYamlTemplate, customParams);
  var jobYaml = jobSpec.jobYaml;
  var jobMessage = jobSpec.jobMessage;

  // Test mode -- just print, do not actually create jobs
  //if (process.env.HF_VAR_K8S_TEST) {
    console.log(JSON.stringify(jobYaml, null, 4));
    console.log(JSON.stringify(jobMessage, null, 2));
    return 0;
  //}

  var namespace = process.env.HF_VAR_NAMESPACE || 'default';

  let taskStart = Date.now();
  console.log("Starting task", taskId, 'time=' + taskStart);

  try {
    k8sApi.createNamespacedJob(namespace, jobYaml).then(
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

  try {
    await context.sendMsgToJob(jobMessage, taskId);
  } catch (err) {
    console.error(err);
    throw err;
  }

  // 'awaitJob' -- wait for the job to finish, possibly restarting it
  // Restart policy -- enable if "HF_VAR_BACKOFF_LIMIT" (number of retries) is defined
  var backoffLimit = process.env.HF_VAR_BACKOFF_LIMIT || 0; 
  var restartPolicy = backoffLimit > 0 ? "OnFailure": "Never"; 
  var restartCount = 0;
  var awaitJob = async(taskId) => {
    try {
      var jobResult = await context.jobResult(0, taskId); // timeout=0 means indefinite
    } catch (err) {
      console.error(err);
      throw err;
    }
    let taskEnd = Date.now();
    console.log('Job ended with result:', jobResult, 'time:', taskEnd);
    var code = parseInt(jobResult[1]); // job exit code
    // if job failed and restart policy is enabled, restart the job
    if (code != 0 && restartPolicy == "OnFailure" && restartCount++ < backoffLimit)  {
      console.log("Job", taskId, "failed, restarting (restartCount:", restartCount + ") ...");
      // When restarting, need to send the message job again!
      try {
        await context.sendMsgToJob(jobMessage, taskId);
      } catch (err) {
        console.error(err);
        throw err;
      }
      return awaitJob(); // just wait again assuming Kubernetes will restart the job
    } 
    return code;
  }

  let jobExitCode = awaitJob(taskId);
  return jobExitCode;
}

async function BojK8sCommand(ins, outs, context, cb) {
  let functionStart = Date.now();
  console.log("[DEBUG] BojK8sInvoke called, time:", functionStart);
  // let cluster = await getCluster();
  // const token = await getGCPToken();

  // support for two clusters (cloud bursting) 
  // if 'HF_VAR_REMOTE_CLUSTER' is defined, we check where this job is assigned to:
  // - the local cluster: we do nothing
  // - the remote cluster: we set KUBECONFIG to load its configuration
  var remoteClusterId = process.env.HF_VAR_REMOTE_CLUSTER;
  if (remoteClusterId) {
    let partition = job.partition;
    if (partition == remoteClusterId) {
      // this will cause reading the kube_config of the remote cluster
      process.env.KUBECONFIG = process.env.HF_VAR_KUBE_CONFIG_PATH || "./kube_config";
    }
  }

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  const k8sApi = kc.makeApiClient(k8s.BatchV1Api);

  let jobsFileName = ins["jobSetsFile"].data[0];
  let jobs = JSON.parse(fs.readFileSync(jobsFileName));

  // run job sets in parallel with concurrency limit
  const PromisePool = require('@supercharge/promise-pool');
  const { results, errors } = await PromisePool
    .for(jobs)
    .withConcurrency(5)
    .process(async jobs => {
      jobPromises = jobs.map(job => {
        //let taskId = job.name + "-" + jsetIdx + "-" + jIdx;
        let taskId = job.name;
        let customParams = {};
        return submitK8sJob(job, taskId, context, customParams);
      });
      jobExitCodes = await Promise.all(jobPromises);
      return jobExitCodes;
    });

  console.log(results, errors);

  /*
  jobs.forEach((jobSet, jsetIdx) => {
    jobSet.forEach(async(job, jIdx) => {
      let taskId = job.name + "-" + jsetIdx + "-" + jIdx;
      let customParams = {};
      let code = await submitK8sJob(job, taskId, context, customParams);
      if (code == 0) {
        console.log('Job ' + taskId + ' succeeded!');
      } else {
        console.log('Job ' + taskId + ' failed! (Exit code:', code + ')');
      }
    });
  });
  */

  let functionEnd = Date.now();
  console.log("[DEBUG] BojK8sInvoke exiting, time:", functionEnd);
  cb(null, outs);
}

exports.BojK8sCommand = BojK8sCommand;
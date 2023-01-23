// bojK8sCommand.js
// Runs bags-of-jobs on a Kubernetes cluster

const tracer = require("../../tracing.js")("hyperflow-kubernetes");
const k8s = require('@kubernetes/client-node');
var submitK8sJob = require('./k8sJobSubmit.js').submitK8sJob;
var fs = require('fs');

async function bojK8sCommand(ins, outs, context, cb) {
  let functionStart = Date.now();
  console.log("[DEBUG] bojK8sInvoke called, time:", functionStart);
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

  const kubeconfig = new k8s.KubeConfig();
  kubeconfig.loadFromDefault(); // loadFromString(JSON.stringify(kconfig))

  let jobsFileName = ins["jobSetsFile"].data[0];
  let jobs = JSON.parse(fs.readFileSync(jobsFileName));

  // run job sets in parallel with concurrency limit
  tracer.startActiveSpan('bojK8s', async span => {
    const PromisePool = require('@supercharge/promise-pool');
    const {results, errors} = await PromisePool
        .for(jobs)
        .withConcurrency(5)
        .process(async jobs => {
          jobPromises = jobs.map(job => {
            //let taskId = job.name + "-" + jsetIdx + "-" + jIdx;
            let taskId = job.name;
            let customParams = {};
            var traceId = span.spanContext().traceId
            var parentId = span.spanContext().spanId
            return submitK8sJob(kubeconfig, job, taskId, context, customParams, parentId, traceId);
          });
          jobExitCodes = await Promise.all(jobPromises);
          return jobExitCodes;
        });
    span.end();
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
  console.log("[DEBUG] bojK8sInvoke exiting, time:", functionEnd);
  cb(null, outs);
}

exports.bojK8sCommand = bojK8sCommand;
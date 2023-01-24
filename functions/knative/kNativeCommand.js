// Runs a service in a KNative cluster

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const axios = require("axios");

SERVICE_YAML_TEMPLATE = `
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: {name}
  namespace: {namespace}
spec:
  template:
    spec:
      containers:
      - image: docker.io/{image}
        env:{dataParams}`;


const interpolate = (tpl, args) => tpl.replace(/{(\w+)}/g, (_, v) => args[v]);

async function kNativeCommand(ins, outs, context, cb) {

    function createData() {
        const data = ins[0].data[0];
        const dataString = `
        - name: {key}
          value: "{value}"`;
        let amountParams = {
            key: "DATA_NUM",
            value: data.length
        }
        let result = interpolate(dataString, amountParams);
        for (let i = 0; i < data.length; i++) {
            let dataParams = {
                key: `DATA${i}`,
                value: data[i]
            }
            result += interpolate(dataString, dataParams);
        }
        return result;
    }

    async function execute(spec, client, url) {
        const startTime = Date.now();
        axios({
            method: 'get',
            url: url,
            headers: {'content-type': 'application/json'}
        }).then(async response => {
            const endTime = Date.now();
            console.log(`Execution time: ${(endTime - startTime) / 1000} seconds`);
            const json = response.data;
            console.log(json);
            await deleteService(spec, client);
            outs[0].data = json;
            cb(null, outs);
        }).catch(() => {
            console.log("Waiting for pod to become ready");
            setTimeout(() => execute(spec, client, url), 5000);
        });
    }

    async function getCondition(spec, client, name, url) {
        response = await client.read({
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: {
                name: `${name}-deployment`,
                namespace: context.namespace ? context.namespace : "default",
            }
        });
        const condition = response.body.status.conditions[0].type;
        console.log(`Current condition: ${condition}`);
        if (condition !== "Available") {
            setTimeout(() => getCondition(spec, client, name, url), 1000);
        } else {
            console.log("Executing...");
            await execute(spec, client, url);
        }
    }

    async function deleteService(spec, client) {
        console.log("Deleting...");
        await client.delete(spec);
        console.log("Service deleted");
    }

    async function scheduleExecution(spec, client) {
        let response = await client.read(spec);
        const url = response.body.status.url;
        console.log("Obtained service url: " + url);
        setTimeout(() => getCondition(spec, client, response.body.status.latestCreatedRevisionName, url), 1000);
    }

    const kubeconfig = new k8s.KubeConfig();
    kubeconfig.loadFromDefault();

    const params = {
        name: context.name,
        namespace: context.namespace ? context.namespace : "default",
        image: context.image,
        dataParams: createData(ins)
    }

    const spec = yaml.safeLoad(interpolate(SERVICE_YAML_TEMPLATE, params));

    const client = k8s.KubernetesObjectApi.makeApiClient(kubeconfig);
    let response = await client.create(spec);
    setTimeout(() => scheduleExecution(spec, client, outs, cb), 3000);
}

exports.kNativeCommand = kNativeCommand;

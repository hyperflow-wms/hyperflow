"use strict";

const aws = require("aws-sdk");
aws.config.update({region: 'eu-west-1'}); // aws sdk doesn't load region by default
const ecs = new aws.ECS();
const executor_config = require('./awsFargateCommand.config.js');
const TASK_LIMIT = 50;

async function awsFargateCommand(ins, outs, config, cb) {

    const options = executor_config.options;
    if (config.executor.hasOwnProperty('options')) {
        let executorOptions = config.executor.options;
        for (let opt in executorOptions) {
            if (executorOptions.hasOwnProperty(opt)) {
                options[opt] = executorOptions[opt];
            }
        }
    }

    const executable = config.executor.executable;
    const jobMessage = JSON.stringify({
        "executable": executable,
        "args": config.executor.args,
        "env": (config.executor.env || {}),
        "inputs": ins.map(i => i),
        "outputs": outs.map(o => o),
        "options": options,
        "stdout": config.executor.stdout
    });

    await waitUntilBelowTaskLimit();

    console.log("Executing: " + jobMessage + " on AWS Fargate");

    ecs.runTask(await createFargateTask(), function (err, data) {
        if (err) {
            console.log("Running fargate task " + executable + " failed, error: " + err);
        } else {
            let taskArn = data.tasks[0].taskArn;
            let params = {
                cluster: executor_config.cluster_arn,
                tasks: [taskArn],
            };
            ecs.waitFor('tasksStopped', params, function (err, data) {
                if (err) {
                    console.log("Error during waiting for task completion: " + err);
                } else {
                    let containerStatusCode = data.tasks[0].containers[0].exitCode;
                    if (containerStatusCode !== 0) {
                        console.log("Error: container returned status code: " + containerStatusCode + " for task " + executable + " with arn: " + taskArn);
                        return
                    }
                    console.log("Fargate task: " + executable + " with arn: " + taskArn + " completed successfully.");
                    cb(null, outs);
                }
            });
        }
    });


    async function createFargateTask() {
        return {
            taskDefinition: await getTaskDefinition(),
            cluster: executor_config.cluster_arn,
            count: 1,
            enableECSManagedTags: false,
            launchType: 'FARGATE',
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: [executor_config.subnet_1, executor_config.subnet_2],
                    assignPublicIp: 'ENABLED',
                    securityGroups: []
                }
            },
            "overrides": {
                "containerOverrides": [
                    {
                        "command": ["npm", "start", jobMessage],
                        "name": executor_config.container_name
                    }
                ]
            },
            platformVersion: 'LATEST',
            startedBy: 'hyperflow'
        };
    }

    async function getTaskDefinition() {
        const mapping = executor_config.mapping;
        if (mapping === undefined) {
            let errorMessage = "Missing mapping in config";
            console.log(errorMessage);
            return
        }
        let taskDefinition = mapping[executable] === undefined ? mapping["default"] : mapping[executable];
        if (taskDefinition === undefined) {
            let errorMessage = "No task mapping nor default mapping is defined for " + executable;
            console.log(errorMessage);
            return
        }
        return taskDefinition;
    }

    async function waitUntilBelowTaskLimit() {
        let response = await checkRunningTaskCount();
        while (response.taskArns.length >= TASK_LIMIT) {
            console.log("Reached task count limit, waiting for some task to finish..");
            await sleep(10000);
            response = await checkRunningTaskCount();
        }
    }

    function checkRunningTaskCount() {
        return ecs.listTasks({
            cluster: executor_config.cluster_arn,
            desiredStatus: "RUNNING"
        }).promise()
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

exports.awsFargateCommand = awsFargateCommand;
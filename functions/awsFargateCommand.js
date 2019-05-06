"use strict";

const aws = require("aws-sdk");
aws.config.update({region: "eu-central-1"}); // aws sdk doesn't load region by default
const ecs = new aws.ECS();
const executor_config = require("./awsFargateCommand.config.js");
const baseTimeFrame = 10000;
const maxRetries = 12;

async function awsFargateCommand(ins, outs, config, cb) {

    const options = executor_config.options;
    if (config.executor.hasOwnProperty("options")) {
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

    const runTaskWithRetryStrategy = async (times) => {
        try {
            await runTask();
        } catch (error) {
            if (["ThrottlingException", "NetworkingError", "TaskLimitError"].includes(error.name)) {
                if (times < maxRetries) {
                    console.log("Fargate runTask method threw " + error.name + ", performing retry number " + (times + 1));
                    return backoffWait(times)
                        .then(runTaskWithRetryStrategy.bind(null, times + 1));
                }
            }
            console.log("Running fargate task " + executable + " failed after " + times + " retries, error: " + error.name);
            return;
        }
        cb(null, outs);
    };

    console.log(`Executing: ${jobMessage} on AWS Fargate`);

    await runTaskWithRetryStrategy(0);

    function runTask() {
        return new Promise((resolve, reject) => {
            ecs.runTask(createFargateTask(), (err, data) => {
                if (err) {
                    if (err.message.indexOf('RequestLimitExceeded') > -1) {
                        return reject(new TaskLimitError())
                    } else {
                        return reject(err);
                    }
                }

                if (data.failures && data.failures.map(failure => failure.reason).includes("You\'ve reached the limit on the number of tasks you can run concurrently")) {
                    return reject(new TaskLimitError());
                }

                let taskArn = data.tasks[0].taskArn;

                waitAndGetExitCode(taskArn).then(containerStatusCode => {
                    if (containerStatusCode !== 0) {
                        console.log("Error: container returned non-zero exit code: " + containerStatusCode + " for task " + executable + " with arn: " + taskArn);
                        return reject();
                    }

                    console.log("Fargate task: " + executable + " with arn: " + taskArn + " completed successfully.");
                    return resolve()
                }).catch(err => reject(err));
            });
        })
    }

    async function backoffWait(times) {
        let backoffTimes = Math.pow(2, times);
        let backoffWaitTime = Math.floor(Math.random() * backoffTimes + 1) * baseTimeFrame;
        return new Promise(resolve => setTimeout(resolve, backoffWaitTime));
    }

    function createFargateTask() {
        return {
            taskDefinition: executor_config.taskArn,
            cluster: executor_config.clusterArn,
            count: 1,
            enableECSManagedTags: false,
            launchType: 'FARGATE',
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: executor_config.subnets,
                    assignPublicIp: executor_config.assignPublicIp,
                    securityGroups: executor_config.securityGroups
                }
            },
            overrides: {
                containerOverrides: [
                    {
                        command: ['npm', 'start', jobMessage],
                        name: executor_config.containerName,
                        environment: [
                            {name: 'NAME', value: executor_config.containerName},
                            {name: 'TASK_ID', value: executable},
                            {name: 'PUSH_GW_URL', value: executor_config.pushgatewayUrl},
                            {
                                name: 'LABELS',
                                // stringify object {key: val,key1: val1} to 'key=val,key1=val1'
                                value: Object.entries(executor_config.extraLabels).map(array => array.join('=')).join(',')
                            }
                        ]
                    }
                ]
            },
            platformVersion: 'LATEST',
            startedBy: 'hyperflow'
        };
    }

    async function getTaskDefinition() {
        const mapping = executor_config.tasks_mapping;
        if (mapping === undefined) {
            let errorMessage = "Missing tasks_mapping in config";
            console.log(errorMessage);
            return
        }
        let taskDefinition = mapping[executable] === undefined ? mapping["default"] : mapping[executable];
        if (taskDefinition === undefined) {
            let errorMessage = "No task tasks_mapping nor default tasks_mapping is defined for " + executable;
            console.log(errorMessage);
            return
        }
        return taskDefinition;
    }

    async function getTaskContainer(taskDefinition) {
        let task = await ecs.describeTaskDefinition({taskDefinition}).promise();
        return task.taskDefinition.containerDefinitions[0].name;
    }

    async function waitAndGetExitCode(taskArn) {
        const payload = {
            tasks: [taskArn],
            cluster: executor_config.clusterArn
        };
        let taskList = await ecs.describeTasks(payload).promise();
        while (taskList.tasks[0].lastStatus !== "STOPPED") {
            await sleep(5000);
            taskList = await ecs.describeTasks(payload).promise();
        }
        return taskList.tasks[0].containers[0].exitCode;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class TaskLimitError extends Error {
    constructor() {
        super();
        this.name = "TaskLimitError";
    }
}

exports.awsFargateCommand = awsFargateCommand;
"use strict";

const aws = require("aws-sdk");
aws.config.update({region: "eu-west-1"}); // aws sdk doesn't load region by default
const ecs = new aws.ECS();
const maxRetryWait = 10 * 60 * 1000; // 10 minutes
let runLock = false;
let runningTasks = 0;

async function awsFargateCommand(ins, outs, config, cb) {

    while (runLock === true || runningTasks >= 50) {
        await sleep(1500);
    }
    runLock = true;
    await sleep(1500);
    runLock = false;
    runningTasks++;

    const executor_config = await getConfig(config.workdir);

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

    const runTaskWithRetryStrategy = (times) => new Promise(() => {
        return runTask()
            .catch(error => {
                if (["ThrottlingException", "NetworkingError", "TaskLimitError"].includes(error.name)) {
                    console.log("Fargate runTask method threw " + error.name + ", performing retry number " + (times + 1));
                    return backoffWait(times)
                        .then(runTaskWithRetryStrategy.bind(null, times + 1));
                }
                console.log("Running fargate task " + executable + " failed after " + times + " retries, error: " + error);
            });
    });

    console.log("Executing: " + jobMessage + " on AWS Fargate");
    await runTaskWithRetryStrategy(0);

    async function getConfig(workdir) {
        let config;
        try {
            config = require(workdir + "/awsFargateCommand.config.js");
        } catch (e) {
            console.log("No config in " + workdir + ", loading config from default location: .");
            config = require("./awsFargateCommand.config.js");
        }
        return config;
    }

    async function runTask() {
        await ecs.runTask(await createFargateTask()).promise().then(async function (data) {
            if (data.failures && data.failures.map(failure => failure.reason).includes("You\'ve reached the limit on the number of tasks you can run concurrently")) {
                throw new TaskLimitError()
            }
            let taskArn = data.tasks[0].taskArn;
            let containerStatusCode = await waitAndGetExitCode(taskArn);
            if (containerStatusCode !== 0) {
                console.log("Error: container returned non-zero exit code: " + containerStatusCode + " for task " + executable + " with arn: " + taskArn);
                return
            }
            console.log("Fargate task: " + executable + " with arn: " + taskArn + " completed successfully.");
            runningTasks--;
            cb(null, outs);
        });
    }

    async function backoffWait(times) {
        let backoffTimes = Math.pow(2, times);
        let backoffWaitTime = Math.floor(Math.random() * backoffTimes) * 500;
        if (backoffWaitTime > maxRetryWait) {
            backoffWaitTime = maxRetryWait;
        }
        console.log("Waiting for " + backoffWaitTime + " milliseconds.");
        return new Promise(resolve => setTimeout(resolve, backoffWaitTime));
    }

    async function createFargateTask() {
        let taskDef = await getTaskDefinition();
        let taskContainer = await getTaskContainer(taskDef);
        return {
            taskDefinition: taskDef,
            cluster: executor_config.cluster_arn,
            count: 1,
            enableECSManagedTags: false,
            launchType: "FARGATE",
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: [executor_config.subnet_1, executor_config.subnet_2],
                    assignPublicIp: "ENABLED",
                    securityGroups: []
                }
            },
            "overrides": {
                "containerOverrides": [
                    {
                        "command": ["npm", "start", jobMessage],
                        "name": taskContainer
                    }
                ]
            },
            platformVersion: "LATEST",
            startedBy: "hyperflow"
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
            cluster: executor_config.cluster_arn
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
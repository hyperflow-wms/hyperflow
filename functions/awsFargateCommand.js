'use strict';

const aws = require('aws-sdk');
aws.config.update({region: 'eu-central-1'}); // aws sdk doesn't load region by default
const ecs = new aws.ECS();
const s3 = new aws.S3();
const Influx = require('influx');
const uuid = require('uuid/v4');

const executor_config = require('./awsFargateCommand.config');

const maxRetryWait = 5 * 60 * 1000; // 2 minutes
let runLock = false;

let runningTasks = 0;
let retryAmount = 0;
let waitingTasks = 0;

function initInflux(dbName, experiment) {
    const tags = {
        experiment: experiment
    };

    let influx = new Influx.InfluxDB({
        host: 'localhost',
        database: dbName,
        schema: [
            {
                measurement: 'diagnostic',
                fields: {
                    waitingTasks: Influx.FieldType.INTEGER,
                    retryAmount: Influx.FieldType.INTEGER
                },
                tags: Object.keys(tags)
            }
        ]
    });

    function write() {
        influx.writeMeasurement('diagnostic', [{
            tags: tags,
            fields: {waitingTasks: waitingTasks, retryAmount: retryAmount}
        }]).catch(console.error);
    }

    influx.createDatabase(dbName)
        .then(() => setInterval(write, 5000))
}

initInflux('hyperflow-database', new Date().toISOString());

async function awsFargateCommand(ins, outs, config, cb) {
    while (runLock === true || runningTasks >= 50) {
        await sleep(1500);
    }
    runLock = true;
    await sleep(1500);
    runLock = false;
    runningTasks++;

    let isTaskWaiting = false;

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
            if (["ThrottlingException", "NetworkingError", "TaskLimitError", "OutOfMemoryError"].includes(error.name)) {

                retryAmount++;

                if (!isTaskWaiting) {
                    waitingTasks++;
                    isTaskWaiting = true;
                }

                console.log("Fargate runTask method threw " + error.name + ", performing retry number " + (times + 1));
                return backoffWait(times)
                    .then(runTaskWithRetryStrategy.bind(null, times + 1));
            }

            console.log("Running fargate task " + executable + " failed after " + times + " retries, error: " + error
                + ', error.message: ' + error.message);

            // exit on unexpected failure of any task
            process.exit(1);

            return;
        }
        cb(null, outs);
    };

    console.log(`Executing: ${jobMessage} on AWS Fargate`);

    await runTaskWithRetryStrategy(0);

    function runTask() {
        return new Promise((resolve, reject) => {
            createFargateTask().then(task => {
                ecs.runTask(task, (err, data) => {
                    if (err) {
                        if (err.message.indexOf('RequestLimitExceeded') > -1) {
                            return reject(new TaskLimitError())
                        } else {
                            return reject(err);
                        }
                    }

                    if (data.failures && data.failures.length > 0) {
                        let reason = data.failures.map(failure => failure.reason);

                        if (reason.includes("You\'ve reached the limit on the number of tasks you can run concurrently")) {
                            return reject(new TaskLimitError());
                        }

                        if (reason.includes('RESOURCE:MEMORY')) {
                            return reject(new OutOfMemoryError())
                        }

                        console.log(`Unhandled err: ${data.failures}`);
                    }

                    let taskArn = data.tasks[0].taskArn;

                    waitAndGetExitCode(taskArn).then(containerStatusCode => {
                        if (containerStatusCode !== 0) {
                            console.log("Error: container returned non-zero exit code: " + containerStatusCode + " for task " + executable + " with arn: " + taskArn);
                            return reject(new Error(taskArn));
                        }

                        console.log("Fargate task: " + executable + " with arn: " + taskArn + " completed successfully.");

                        runningTasks--;

                        if (isTaskWaiting) {
                            waitingTasks--;
                        }

                        return resolve()
                    }).catch(err => reject(err));
                });
            });
        })
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
        return executor_config.launchType === 'FARGATE' ? {
                taskDefinition: executor_config.taskArn,
                cluster: executor_config.clusterArn,
                count: 1,
                enableECSManagedTags: false,
                launchType: 'FARGATE',
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: executor_config.subnets,
                        assignPublicIp: 'DISABLED',
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
            } :
            {
                taskDefinition: executor_config.taskArn,
                cluster: executor_config.clusterArn,
                count: 1,
                enableECSManagedTags: false,
                launchType: 'EC2',
                overrides: {
                    containerOverrides: [
                        {
                            command: ['npm', 'start', jobMessage],
                            name: executor_config.containerName,
                            environment: [
                                {name: 'NAME', value: executor_config.containerName},
                                {name: 'TASK_ID', value: executable},
                                {name: 'INFLUXDB_HOST', value: executor_config.influxdbHost},
                                {
                                    name: 'LABELS',
                                    // stringify object {key: val,key1: val1} to 'key=val,key1=val1'
                                    value: Object.entries(executor_config.extraLabels).map(array => array.join('=')).join(',')
                                }
                            ]
                        }
                    ]
                },
                startedBy: 'hyperflow'
            }
    }

    async function waitAndGetExitCode(taskArn) {
        const payload = {
            tasks: [taskArn],
            cluster: executor_config.clusterArn
        };

        let taskList;

        do {
            taskList = await ecs.describeTasks(payload).promise();

            if (taskList.failures && taskList.failures.length > 0) {
                // throw new Error(`${taskArn}: task.failures: ${JSON.stringify(taskList.failures)}`);
                await sleep(5000);
                continue;
            }

            let container = taskList.tasks[0].containers[0];
            if (container.exitCode === 137) {
                throw new OutOfMemoryError(taskArn);
            }

            await sleep(5000);
        } while (taskList.tasks[0].lastStatus !== "STOPPED");

        let exitCode = taskList.tasks[0].containers[0].exitCode;

        return exitCode !== undefined ? exitCode : taskList.tasks[0].containers[0].reason;
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

class OutOfMemoryError extends Error {
    constructor(taskArn) {
        super();
        this.name = 'OutOfMemoryError';
        this.message = `taskArn: ${taskArn}`;
    }
}

exports.awsFargateCommand = awsFargateCommand;

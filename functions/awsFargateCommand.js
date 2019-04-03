"use strict";

const aws = require("aws-sdk");
aws.config.update({region: 'eu-west-1'}); // aws sdk doesn't load region by default
const ecs = new aws.ECS();
const executor_config = require('./awsFargateCommand.config.js');
const identity = i => i;

function awsFargateCommand(ins, outs, config, cb) {

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
        "inputs": ins.map(identity),
        "outputs": outs.map(identity),
        "options": options,
        "stdout": config.executor.stdout
    });

    const fargateTask = {
        taskDefinition: executor_config.task_definition_name,
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
                    "name": executor_config.cluster_name
                }
            ]
        },
        platformVersion: 'LATEST',
        startedBy: 'hyperflow'
    };

    ecs.runTask(fargateTask, function (err, data) {
        if (err) {
            console.log("Running fargate task " + executable + " failed, error: " + err);
            cb(err, outs);
        } else {
            let taskArn = data.tasks[0].taskArn;
            console.log("Executing: " + jobMessage + "@" + taskArn);
            let params = {
                cluster: executor_config.cluster_arn,
                tasks: [taskArn],
            };
            ecs.waitFor('tasksStopped', params, function (err, data) {
                if (err) {
                    cb(err, outs);
                } else {
                    let containerStatusCode = data.tasks[0].containers[0].exitCode;
                    if (containerStatusCode !== 0) {
                        console.log("Error: container returned status code 1");
                        cb(new Error(), outs);
                        return
                    }
                    console.log("Fargate task: " + executable + " completed: " + taskArn);
                    cb(null, outs);
                }
            });
        }
    });

}

exports.awsFargateCommand = awsFargateCommand;
import { ECSClient } from "@aws-sdk/client-ecs";
import { RunTaskCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";

const argv = yargs(hideBin(process.argv))
    .option("cluster", {
        alias: "c",
        description: "cluster ARN",
        type: "string",
        demandOption: false,
    })
    .option("task", {
        alias: "t",
        description: "task ARN",
        type: "string",
        demandOption: false,
    })
    .option("subnet", {
        alias: "s",
        description: "subnet id",
        type: "string",
        demandOption: false,
    })
    .help()
    .alias("help", "h").argv;

export async function main(args) {
    const ecsClient = new ECSClient({ region: "us-east-1" });

    try {
        const params = {
            cluster: args.cluster,
            launchType: "FARGATE",
            taskDefinition: args.task,
            count: 1,
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: [args.subnet],
                    securityGroups: [],
                    assignPublicIp: "ENABLED",
                },
            },
        };

        const command = new RunTaskCommand(params);
        const response = await ecsClient.send(command);
        console.log(response);
    } catch (err) {
        console.error("Error executing ECS Fargate task:", err);
    }
}

main(argv);

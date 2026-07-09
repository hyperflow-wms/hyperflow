import { ECSClient } from "@aws-sdk/client-ecs";
import { EFSClient } from "@aws-sdk/client-efs";
import { EC2Client } from "@aws-sdk/client-ec2";
import { S3Client } from "@aws-sdk/client-s3";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import fs from "fs";

import { createVPCAndSubnets } from "./vpcUtils.js";
import { createEFSFileSystem } from "./efsUtils.js";
import { createTaskDefinitions, setupCluster } from "./ecsUtils.js";
import { createS3Bucket, runDataSyncTask } from "./dataUtils.js";

const REGION = "us-east-1";

async function main(args) {
  if (args.dryRun) {
    console.log("🔍 DRY RUN MODE - No actual AWS calls will be made");
    console.log("=".repeat(50));
  }

  const ecsClient = new ECSClient({ region: REGION });
  const ec2Client = new EC2Client({ region: REGION });
  const efsClient = new EFSClient({ region: REGION });
  const s3Client = new S3Client({ region: REGION });

  const vpcData = await createVPCAndSubnets(ec2Client, args.dryRun);
  if (vpcData.length === 0) {
    console.error("Error creating VPC and subnets");
    return;
  }
  const securityGroupId = vpcData.securityGroup.GroupId;
  const clusterData = await setupCluster(ecsClient, args.dryRun);
  const efsData = await createEFSFileSystem(
    efsClient,
    vpcData,
    securityGroupId,
    args.dryRun
  );
  const taskDefinitions = await createTaskDefinitions(
    ecsClient,
    efsData,
    args.roleArn,
    args.configPath,
    args.dryRun
  );
  console.log("Task definitions created successfully:", taskDefinitions);
  const s3BucketData = await createS3Bucket(s3Client, args.dryRun);
  console.log("S3 bucket name:", s3BucketData.Location);

  // Read config file to get dataProvider image for data sync
  const mappingConfigContent = fs.readFileSync(args.configPath, "utf8");
  const config = JSON.parse(mappingConfigContent);

  if (
    config.dataProvider &&
    config.dataContainer &&
    taskDefinitions.dataProvider
  ) {
    console.log("Running data sync via data provider task...");
    await runDataSyncTask(
      ecsClient,
      clusterData.clusterArn,
      vpcData.subnets[0].SubnetId,
      taskDefinitions.dataProvider.taskDefinitionArn,
      args.dryRun
    );
    console.log("Data sync complete");
  } else if (!config.dataProvider || !config.dataContainer) {
    console.log("Data provider configuration not found, skipping data sync...");
  }

  // Generate tasks_mapping for all task definitions
  const tasksMapping = Object.entries(taskDefinitions).reduce(
    (acc, [key, taskDef]) => {
      acc[key] = taskDef.taskDefinitionArn;
      return acc;
    },
    {}
  );

  // Generate vcpu_mapping for worker tasks only (exclude dataProvider)
  const vcpuMapping = Object.entries(config)
    .filter(([key]) => key !== "dataProvider" && key !== "dataContainer")
    .reduce((acc, [key, workerConfig]) => {
      acc[key] = workerConfig.cpu || 1024;
      return acc;
    }, {});

  const awsConfigContent = `exports.cluster_arn = "${clusterData.clusterArn}";
exports.subnet_1 = "${vpcData.subnets[0].SubnetId}";
exports.metrics = true;

exports.options = {
    "bucket": "${s3BucketData.Location}",
    "prefix": "hyperflow",
};

exports.tasks_mapping = ${JSON.stringify(tasksMapping, null, 4)};

exports.vcpu_mapping = ${JSON.stringify(vcpuMapping, null, 4)};
`;

  fs.writeFileSync("awsFargateCommand.config.js", awsConfigContent);
  console.log(
    "AWS Fargate configuration successfully written to awsFargateCommand.config.js"
  );

  if (args.dryRun) {
    console.log("=".repeat(50));
    console.log("🔍 DRY RUN COMPLETE - No actual resources were created");
  }
}

const argv = yargs(hideBin(process.argv))
  .option("configPath", {
    alias: "c",
    description: "Path to mapping config file containing task definitions",
    type: "string",
    demandOption: true,
  })
  .option("roleArn", {
    alias: "r",
    description: "Role ARN for task execution",
    type: "string",
    demandOption: true,
  })
  .option("dryRun", {
    alias: "d",
    description: "Perform a dry run without making actual AWS calls",
    type: "boolean",
    default: false,
  })
  .help()
  .alias("help", "h").argv;

main(argv);

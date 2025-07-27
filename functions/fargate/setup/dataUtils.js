import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { RunTaskCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createS3Bucket(s3Client, dryRun = false) {
  const bucketName = `hyperflow-fargate-${Date.now()}`;

  if (dryRun) {
    console.log(`📝 [DRY RUN] Would create S3 bucket:`);
    console.log(`   - Bucket name: ${bucketName}`);
    console.log(`   - Command: CreateBucketCommand`);

    // Return mock S3 data
    return {
      Location: `https://${bucketName}.s3.amazonaws.com/`,
      BucketName: bucketName,
    };
  }

  try {
    const bucketParams = {
      Bucket: bucketName,
    };

    // Create the S3 bucket
    const data = await s3Client.send(new CreateBucketCommand(bucketParams));

    console.log("S3 bucket created successfully:", data);
    return data;
  } catch (err) {
    console.error("Error creating S3 bucket:", err);
  }
}

export async function runDataSyncTask(
  ecsClient,
  clusterArn,
  subnetId,
  taskDefinitionArn,
  dryRun = false
) {
  if (dryRun) {
    console.log(`📝 [DRY RUN] Would run data sync task:`);
    console.log(`   - Cluster: ${clusterArn}`);
    console.log(`   - Task definition: ${taskDefinitionArn}`);
    console.log(`   - Subnet: ${subnetId}`);
    console.log(`   - Launch type: FARGATE`);
    console.log(`   - Public IP: ENABLED`);
    return;
  }

  try {
    const params = {
      cluster: clusterArn,
      launchType: "FARGATE",
      taskDefinition: taskDefinitionArn,
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: [subnetId],
          securityGroups: [],
          assignPublicIp: "ENABLED",
        },
      },
    };

    const command = new RunTaskCommand(params);
    const response = await ecsClient.send(command);

    let syncFinished = false;
    while (!syncFinished) {
      const taskArn = response.tasks[0].taskArn;
      const probeCommand = new DescribeTasksCommand({
        cluster: clusterArn,
        tasks: [taskArn],
      });
      const probeResponse = await ecsClient.send(probeCommand);
      const task = probeResponse.tasks[0];
      if (task.lastStatus === "STOPPED") {
        syncFinished = true;
        return;
      } else {
        console.log("Data sync task still running...");
        await sleep(15000); // Wait for 15 seconds before the next check
      }
    }
  } catch (err) {
    console.error("Error executing ECS Fargate task:", err);
  }
}

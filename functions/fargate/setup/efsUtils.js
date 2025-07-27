import {
  CreateFileSystemCommand,
  CreateMountTargetCommand,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
} from "@aws-sdk/client-efs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createEFSFileSystem(
  efsClient,
  vpcData,
  securityGroupId,
  dryRun = false
) {
  if (dryRun) {
    console.log(`📝 [DRY RUN] Would create EFS file system:`);
    console.log(`   - Performance mode: generalPurpose`);
    console.log(`   - Encrypted: false`);
    console.log(`   - Mount targets in ${vpcData.subnets.length} subnets`);
    console.log(`   - Security group: ${securityGroupId}`);

    // Return mock EFS data
    return {
      FileSystemId: "fs-mock123456789abcdef0",
      FileSystemArn:
        "arn:aws:elasticfilesystem:us-east-1:123456789012:file-system/fs-mock123456789abcdef0",
      CreationToken: `hyperflow-efs-volume-${Date.now()}`,
      LifeCycleState: "available",
      NumberOfMountTargets: vpcData.subnets.length,
      SizeInBytes: {
        Value: 0,
        ValueInIA: 0,
        ValueInStandard: 0,
      },
    };
  }

  try {
    const fileSystemParams = {
      CreationToken: `hyperflow-efs-volume-${Date.now()}`,
      PerformanceMode: "generalPurpose",
      Encrypted: false,
    };

    const fileSystemData = await efsClient.send(
      new CreateFileSystemCommand(fileSystemParams)
    );
    await waitForFileSystemAvailable(efsClient, fileSystemData.FileSystemId);
    console.log("EFS file system created successfully:", fileSystemData);

    for (let i = 0; i < vpcData.subnets.length; i++) {
      const subnet = vpcData.subnets[i];
      const mountTargetParams = {
        FileSystemId: fileSystemData.FileSystemId,
        SubnetId: subnet.SubnetId,
        SecurityGroups: [vpcData.securityGroup.GroupId],
      };
      const mountTargetData = await efsClient.send(
        new CreateMountTargetCommand(mountTargetParams)
      );
    }
    const probeParams = {
      FileSystemId: fileSystemData.FileSystemId,
    };
    let ready = false;
    while (!ready) {
      const data = await efsClient.send(
        new DescribeMountTargetsCommand(probeParams)
      );
      if (data.MountTargets[0].LifeCycleState === "available") {
        ready = true;
      }
      await sleep(5000);
    }
    console.log("Mount targets created successfully");

    return fileSystemData;
  } catch (err) {
    console.error("Error creating EFS file system or mount target:", err);
  }
}

async function waitForFileSystemAvailable(efsClient, fileSystemId) {
  let isAvailable = false;

  while (!isAvailable) {
    const describeParams = {
      FileSystemId: fileSystemId,
    };

    const data = await efsClient.send(
      new DescribeFileSystemsCommand(describeParams)
    );
    const fs = data.FileSystems[0];
    if (fs.LifeCycleState === "available") {
      isAvailable = true;
      return;
    } else {
      console.log("Waiting for file system to become available...");
      await sleep(5000); // Wait for 5 seconds before the next check
    }
  }
}

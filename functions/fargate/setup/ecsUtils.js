import { CreateClusterCommand } from "@aws-sdk/client-ecs";
import { RegisterTaskDefinitionCommand } from "@aws-sdk/client-ecs";
import { readFileSync } from "fs";
const CPU_DEFAULT = "1024";
const MEMORY_DEFAULT = "4096";

const TASK_DEFINITION_BASE = {
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: CPU_DEFAULT,
  memory: MEMORY_DEFAULT,
  runtimePlatform: {
    cpuArchitecture: "X86_64",
    operatingSystemFamily: "LINUX",
  },
};

function getLogConfiguration(name) {
  return {
    logDriver: "awslogs",
    options: {
      "awslogs-group": `/ecs/${name}`,
      "awslogs-create-group": "true",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "ecs",
    },
    secretOptions: [],
  };
}

async function createDataProviderTaskDefinition(
  ecsClient,
  efsData,
  roleArn,
  config,
  dryRun = false
) {
  const dataProviderConfig = config.dataProvider;
  const dataContainerConfig = config.dataContainer;

  const taskDefinition = {
    ...TASK_DEFINITION_BASE,
    family: "data-provider",
    taskRoleArn: roleArn,
    executionRoleArn: roleArn,
    cpu: dataProviderConfig.cpu?.toString() || CPU_DEFAULT,
    memory: dataProviderConfig.memory?.toString() || MEMORY_DEFAULT,
    containerDefinitions: [
      {
        name: "data",
        image: dataContainerConfig.image,
        cpu: 0,
        portMappings: [
          {
            name: "data-80-tcp",
            containerPort: 80,
            hostPort: 80,
            protocol: "tcp",
            appProtocol: "http",
          },
        ],
        essential: false,
        environment: [],
        environmentFiles: [],
        mountPoints: [],
        volumesFrom: [],
        ulimits: [],
        logConfiguration: getLogConfiguration("data"),
        systemControls: [],
      },
      {
        name: "script",
        image: dataProviderConfig.image,
        cpu: 0,
        portMappings: [],
        essential: true,
        environment: [],
        environmentFiles: [],
        mountPoints: [
          {
            sourceVolume: "efsdata",
            containerPath: "/mnt/data",
            readOnly: false,
          },
        ],
        volumesFrom: [
          {
            sourceContainer: "data",
            readOnly: true,
          },
        ],
        systemControls: [],
        logConfiguration: getLogConfiguration("data-provider-script"),
      },
    ],
    volumes: [
      {
        name: "efsdata",
        efsVolumeConfiguration: {
          fileSystemId: efsData.FileSystemId,
          rootDirectory: "/",
        },
      },
    ],
  };

  if (dryRun) {
    console.log(`📝 [DRY RUN] Would register data provider task definition:`);
    console.log(`   - Family: data-provider`);
    console.log(`   - CPU: ${taskDefinition.cpu}`);
    console.log(`   - Memory: ${taskDefinition.memory}`);
    console.log(`   - Data container image: ${dataContainerConfig.image}`);
    console.log(`   - Script container image: ${dataProviderConfig.image}`);
    console.log(`   - EFS FileSystemId: ${efsData.FileSystemId}`);

    // Return mock task definition
    return {
      taskDefinitionArn: `arn:aws:ecs:us-east-1:123456789012:task-definition/data-provider:${Math.floor(Math.random() * 100)}`,
      family: "data-provider",
      taskRoleArn: roleArn,
      executionRoleArn: roleArn,
      networkMode: "awsvpc",
      revision: Math.floor(Math.random() * 100),
      status: "ACTIVE",
      requiresAttributes: [],
    };
  }

  try {
    const data = await ecsClient.send(
      new RegisterTaskDefinitionCommand(taskDefinition)
    );

    console.log(
      "Data provider worker task definition registered successfully:",
      data.taskDefinition
    );
    return data.taskDefinition;
  } catch (err) {
    console.error("Error registering data provider task definition:", err);
  }
}

async function createWorkerTaskDefinition(
  ecsClient,
  efsData,
  roleArn,
  workerKey,
  workerConfig,
  dryRun = false
) {
  const taskDefinition = {
    ...TASK_DEFINITION_BASE,
    family: "worker",
    taskRoleArn: roleArn,
    executionRoleArn: roleArn,
    cpu: workerConfig.cpu?.toString() || CPU_DEFAULT,
    memory: workerConfig.memory?.toString() || MEMORY_DEFAULT,
    containerDefinitions: [
      {
        name: "worker",
        image: workerConfig.image,
        cpu: 0,
        portMappings: [
          {
            name: "worker-80-tcp",
            containerPort: 80,
            hostPort: 80,
            protocol: "tcp",
            appProtocol: "http",
          },
        ],
        essential: true,
        environment: [],
        environmentFiles: [],
        mountPoints: [
          {
            sourceVolume: "efs-volume",
            containerPath: "/mnt/data",
            readOnly: false,
          },
        ],
        volumesFrom: [],
        ulimits: [],
        logConfiguration: getLogConfiguration(`worker-${workerKey}`),
        systemControls: [],
      },
    ],
    volumes: [
      {
        name: "efs-volume",
        efsVolumeConfiguration: {
          fileSystemId: efsData.FileSystemId,
          rootDirectory: "/",
        },
      },
    ],
  };

  if (dryRun) {
    console.log(
      `📝 [DRY RUN] Would register worker task definition for '${workerKey}':`
    );
    console.log(`   - Family: worker`);
    console.log(`   - CPU: ${taskDefinition.cpu}`);
    console.log(`   - Memory: ${taskDefinition.memory}`);
    console.log(`   - Image: ${workerConfig.image}`);
    console.log(`   - EFS FileSystemId: ${efsData.FileSystemId}`);

    // Return mock task definition
    return {
      taskDefinitionArn: `arn:aws:ecs:us-east-1:123456789012:task-definition/worker:${Math.floor(Math.random() * 100)}`,
      family: "worker",
      taskRoleArn: roleArn,
      executionRoleArn: roleArn,
      networkMode: "awsvpc",
      revision: Math.floor(Math.random() * 100),
      status: "ACTIVE",
      requiresAttributes: [],
    };
  }

  try {
    const data = await ecsClient.send(
      new RegisterTaskDefinitionCommand(taskDefinition)
    );

    console.log(
      `Worker task definition for '${workerKey}' registered successfully:`,
      data.taskDefinition
    );
    return data.taskDefinition;
  } catch (err) {
    console.error(
      `Error registering worker task definition for '${workerKey}':`,
      err
    );
  }
}

async function createWorkerTaskDefinitions(
  ecsClient,
  efsData,
  roleArn,
  config,
  dryRun = false
) {
  const workerTaskDefinitions = {};

  // Get all keys except dataProvider and dataContainer
  const workerKeys = Object.keys(config).filter(
    (key) => key !== "dataProvider" && key !== "dataContainer"
  );

  for (const workerKey of workerKeys) {
    const workerConfig = config[workerKey];
    const taskDefinition = await createWorkerTaskDefinition(
      ecsClient,
      efsData,
      roleArn,
      workerKey,
      workerConfig,
      dryRun
    );
    workerTaskDefinitions[workerKey] = taskDefinition;
  }

  return workerTaskDefinitions;
}

export async function createTaskDefinitions(
  ecsClient,
  efsData,
  roleArn,
  configPath,
  dryRun = false
) {
  // Read and parse the mapping config file
  let config;
  try {
    const configContent = readFileSync(configPath, "utf8");
    config = JSON.parse(configContent);
  } catch (err) {
    console.error(`Error reading config file at ${configPath}:`, err);
    throw err;
  }

  // Validate required config keys
  if (!config.default) {
    throw new Error("Config file must contain default key");
  }

  // Create worker task definitions
  const workerTaskDefinitions = await createWorkerTaskDefinitions(
    ecsClient,
    efsData,
    roleArn,
    config,
    dryRun
  );

  const result = { ...workerTaskDefinitions };

  // Conditionally create data provider task definition if both keys exist
  if (config.dataProvider && config.dataContainer) {
    const dataProviderTaskDefinition = await createDataProviderTaskDefinition(
      ecsClient,
      efsData,
      roleArn,
      config,
      dryRun
    );
    result.dataProvider = dataProviderTaskDefinition;
  } else if (dryRun) {
    console.log(
      `📝 [DRY RUN] Skipping data provider task definition - dataProvider or dataContainer not configured`
    );
  }

  return result;
}

export async function setupCluster(ecsClient, dryRun = false) {
  // Define cluster parameters
  const params = {
    clusterName: "hyperflow-cluster",
  };

  if (dryRun) {
    console.log(`📝 [DRY RUN] Would create ECS cluster:`);
    console.log(`   - Cluster name: ${params.clusterName}`);
    console.log(`   - Command: CreateClusterCommand`);

    // Return mock cluster data
    return {
      clusterArn: `arn:aws:ecs:us-east-1:123456789012:cluster/${params.clusterName}`,
      clusterName: params.clusterName,
      status: "ACTIVE",
      runningTasksCount: 0,
      pendingTasksCount: 0,
      activeServicesCount: 0,
    };
  }

  try {
    // Create the cluster
    const data = await ecsClient.send(new CreateClusterCommand(params));
    console.log("Cluster created successfully:", data.cluster);
    return data.cluster;
  } catch (err) {
    console.error("Error creating cluster:", err);
  }
}

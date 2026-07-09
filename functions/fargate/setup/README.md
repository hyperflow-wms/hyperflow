# HyperFlow AWS Fargate Setup

This directory contains scripts to automatically provision and configure AWS infrastructure for running HyperFlow workflows on AWS Fargate.

## Overview

The setup scripts create a complete AWS environment including:

- **VPC & Networking**: Virtual Private Cloud with subnets, internet gateway, and routing
- **EFS Storage**: Elastic File System for shared data across tasks
- **ECS Infrastructure**: Elastic Container Service cluster and task definitions
- **S3 Storage**: Bucket for workflow artifacts and logs
- **Task Definitions**: Configurable worker and data provider containers

## Architecture

```
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐
│   VPC Network   │    │   EFS Storage     │    │   S3 Bucket     │
│                 │    │                   │    │                 │
│ • 2 Subnets     │    │ • Shared Data     │    │ • Artifacts     │
│ • Internet GW   │    │ • Mount Targets   │    │ • Logs          │
│ • Route Tables  │    │ • Security Groups │    │ • Metrics       │
└─────────────────┘    └───────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────────────────┐
                    │  ECS Cluster           │
                    │                        │
                    │ • Worker Tasks         │
                    │ • Data Provider        │
                    │ • Task Definitions     │
                    └────────────────────────┘
```

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Node.js** (v16 or higher)
3. **AWS IAM Role** with permissions for:
   - ECS (clusters, task definitions, tasks)
   - VPC (creation, modification)
   - EFS (file systems, mount targets)
   - S3 (bucket creation)
   - EC2 (security groups, subnets)

## Configuration File

Create a JSON configuration file defining your task types and their resource requirements:

### Required Structure

```json
{
  "default": {
    "cpu": 1024,
    "memory": 4096,
    "image": "your-worker-image-url"
  }
}
```

### Full Example Configuration

```json
{
  "dataProvider": {
    "cpu": 1024,
    "memory": 4096,
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/data-provider:latest"
  },
  "dataContainer": {
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/data-container:latest"
  },
  "default": {
    "cpu": 1024,
    "memory": 4096,
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/worker:latest"
  },
  "mProject": {
    "cpu": 2048,
    "memory": 8192,
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/montage-mproject:latest"
  },
  "mDiffFit": {
    "cpu": 512,
    "memory": 2048,
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/montage-mdifffit:latest"
  }
}
```

### Configuration Keys

| Key | Required | Description |
|-----|----------|-------------|
| `default` | ✅ Yes | Default worker task configuration |
| `dataProvider` | ❌ Optional | Data synchronization task (script container) |
| `dataContainer` | ❌ Optional | Data container with workflow input files |
| `<custom>` | ❌ Optional | Additional worker types with specific requirements |

**Note**: Both `dataProvider` and `dataContainer` must be present together, or both omitted.

## Usage

### Basic Setup

```bash
node index.js --configPath ./workflow_mapping_config.json --roleArn arn:aws:iam::123456789012:role/HyperflowFargateRole
```

### Dry Run Mode

Test your configuration without creating actual AWS resources:

```bash
node index.js --configPath ./workflow_mapping_config.json --roleArn arn:aws:iam::123456789012:role/HyperflowFargateRole --dryRun
```

### Command Line Options

| Option | Short | Description | Required |
|--------|-------|-------------|----------|
| `--configPath` | `-c` | Path to mapping configuration file | ✅ |
| `--roleArn` | `-r` | AWS IAM role ARN for task execution | ✅ |
| `--dryRun` | `-d` | Perform dry run without creating resources | ❌ |

## Output

The script generates `awsFargateCommand.config.js` with the following structure:

```javascript
exports.cluster_arn = "arn:aws:ecs:us-east-1:123456789012:cluster/hyperflow-cluster";
exports.subnet_1 = "subnet-12345abcdef67890";
exports.metrics = true;

exports.options = {
    "bucket": "https://hyperflow-fargate-1234567890.s3.amazonaws.com/",
    "prefix": "hyperflow"
};

exports.tasks_mapping = {
    "default": "arn:aws:ecs:us-east-1:123456789012:task-definition/worker:1",
    "mProject": "arn:aws:ecs:us-east-1:123456789012:task-definition/worker:2",
    "mDiffFit": "arn:aws:ecs:us-east-1:123456789012:task-definition/worker:3",
    "dataProvider": "arn:aws:ecs:us-east-1:123456789012:task-definition/data-provider:1"
};

exports.vcpu_mapping = {
    "default": 1024,
    "mProject": 2048,
    "mDiffFit": 512
};
```

## File Structure

```
setup/
├── README.md                    # This file
├── index.js                     # Main setup orchestrator
├── ecsUtils.js                  # ECS cluster and task definitions
├── vpcUtils.js                  # VPC, subnets, and networking
├── efsUtils.js                  # EFS file system setup
├── dataUtils.js                 # S3 bucket and data sync tasks
├── package.json                 # Node.js dependencies
└── workflow_mapping_config.json # Example configuration
```

## Troubleshooting

### Common Issues

1. **IAM Permissions**: Ensure your role has all required AWS service permissions
2. **ECR Access**: Verify container images are accessible from the execution role
3. **Region Configuration**: All resources are created in `us-east-1` by default
4. **Resource Limits**: Check AWS account limits for ECS tasks, VPC resources

### Validation

Use dry run mode to validate configuration before deployment:
```bash
node index.js -c your-config.json -r your-role-arn --dryRun
```

## Security

- All resources are created within a dedicated VPC
- EFS access restricted to security group rules
- S3 bucket follows AWS default encryption settings
- Task execution role should follow least privilege principle

## Cleanup

The setup scripts create resources but don't include cleanup. To avoid ongoing charges:

1. Delete ECS services and tasks
2. Deregister task definitions
3. Delete ECS cluster
4. Delete EFS file system and mount targets
5. Delete VPC and associated resources
6. Empty and delete S3 bucket 
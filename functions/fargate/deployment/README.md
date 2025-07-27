# HyperFlow AWS Fargate Deployment

This directory contains Docker configurations and build scripts for deploying HyperFlow components on AWS Fargate.

## Overview

The deployment consists of three main Docker images:

1. **Worker** (`hyperflow-worker`) - Node.js application that executes workflow tasks
2. **Data Provider** (`hyperflow-data-provider`) - Alpine-based service for copying data to shared storage
3. **Data Container** (`hyperflow-data-container`) - BusyBox-based container for data initialization

## Prerequisites

- AWS CLI installed and configured with appropriate permissions
- Docker installed and running
- Access to an AWS account with ECR permissions

## Quick Start

### 1. Create ECR Repositories

Create the required ECR repositories for all three images:

```bash
# Create repositories
aws ecr create-repository --repository-name hyperflow-worker
aws ecr create-repository --repository-name hyperflow-data-provider  
aws ecr create-repository --repository-name hyperflow-data-container
```

### 2. Configure ECR Repository ARN

Edit the `Makefile` and replace `ECR_REPO_ARN` with your actual ECR repository ARN prefix:

```makefile
PREFIX = 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

To find your ECR repository ARN prefix:
- Go to AWS Console → ECR → Repositories
- Your prefix follows the format: `{account-id}.dkr.ecr.{region}.amazonaws.com`

### 3. Login to ECR

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

Replace `us-east-1` with your AWS region and `123456789012` with your account ID.

### 4. Build and Push All Images

Use the provided Makefile to build and push all images:

```bash
make all
```

Or build individual images:

```bash
# Build and push worker image
make worker_push

# Build and push data provider image
make data_provider_push

# Build and push data container image
make data_container_push
```

## Manual Build Process

If you prefer to build images manually:

### Worker Image

```bash
cd worker
docker build -t hyperflow-worker . --platform linux/amd64
docker tag hyperflow-worker:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-worker:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-worker:latest
```

### Data Provider Image

```bash
cd data-provider
docker build -t hyperflow-data-provider . --platform linux/amd64
docker tag hyperflow-data-provider:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-data-provider:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-data-provider:latest
```

### Data Container Image

```bash
cd data-provider/data-container
docker build -t hyperflow-data-container . --platform linux/amd64
docker tag hyperflow-data-container:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-data-container:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-data-container:latest
```

## Image Details

### Worker (`hyperflow-worker`)
- **Base Image**: `node:16-alpine`
- **Purpose**: Executes workflow tasks and processes
- **Key Components**:
  - Node.js runtime environment
  - Network monitoring tools (nethogs)
  - Python3 for network monitoring wrapper
  - Application source code and dependencies

### Data Provider (`hyperflow-data-provider`)
- **Base Image**: `alpine`
- **Purpose**: Copies data from container to shared EFS storage
- **Functionality**: Transfers files from `/data/` to `/mnt/data/`

### Data Container (`hyperflow-data-container`)
- **Base Image**: `busybox`
- **Purpose**: Provides initial data for workflows
- **Data Location**: `/data/` directory contains workflow input data

## Configuration

After pushing images to ECR, update your setup configuration file (`workflow_mapping_config.json`) with the ECR repository URLs:

```json
{
    "dataProvider": {
        "cpu": 1024,
        "memory": 4096,
        "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-data-provider:latest"
    },
    "dataContainer": {
        "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-data-container:latest"
    },
    "default": {
        "cpu": 1024,
        "memory": 4096,
        "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/hyperflow-worker:latest"
    }
}
```
### Makefile Variables

- `PREFIX`: ECR repository ARN prefix (must be updated to your values)
- `WORKER_REPO_NAME`: Name of the worker ECR repository
- `PROVIDER_REPO_NAME`: Name of the data provider ECR repository  
- `CONTAINER_REPO_NAME`: Name of the data container ECR repository

## Next Steps

After successfully building and pushing images:

1. Navigate to `../setup/` directory
2. Update the `workflow_mapping_config.json` with your ECR repository URLs
3. Run the setup script to provision AWS infrastructure
4. Configure your HyperFlow workflows to use the Fargate executor

For more information on infrastructure setup, see the [setup directory documentation](../setup/README.md). 
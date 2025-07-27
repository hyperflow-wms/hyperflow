PREFIX = ECR_REPO_ARN # e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com
WORKER_REPO_NAME = hyperflow-worker
PROVIDER_REPO_NAME = hyperflow-data-provider
CONTAINER_REPO_NAME = hyperflow-data-container

all: push


worker_image:
	cd worker && docker build -t $(WORKER_REPO_NAME) . --platform linux/amd64
	docker tag $(WORKER_REPO_NAME):latest $(PREFIX)/$(WORKER_REPO_NAME):latest

worker_push: worker_image
	docker push $(PREFIX)/$(WORKER_REPO_NAME):latest

data_container_image:
	cd data-provider/data-container && docker build -t $(CONTAINER_REPO_NAME) . --platform linux/amd64 
	docker tag $(CONTAINER_REPO_NAME):latest $(PREFIX)/$(CONTAINER_REPO_NAME):latest

data_container_push: data_container_image
	docker push $(PREFIX)/$(CONTAINER_REPO_NAME):latest

data_provider_image:
	cd data-provider && docker build -t $(PROVIDER_REPO_NAME) . --platform linux/amd64
	docker tag $(PROVIDER_REPO_NAME):latest $(PREFIX)/$(PROVIDER_REPO_NAME):latest

data_provider_push: data_provider_image
	docker push $(PREFIX)/$(PROVIDER_REPO_NAME):latest

push: worker_push
	make data_container_push
	make data_provider_push
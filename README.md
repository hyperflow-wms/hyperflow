# HyperFlow: a scientific workflow execution engine

## Description

HyperFlow is a Workflow Management System (WMS) dedicated for scientific workflows. 

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more about the HyperFlow workflow model. 

## Getting started

The latest release of HyperFlow is 1.3.0

### Installation
* Install Node.js (http://nodejs.org)
* Install Redis (http://redis.io) 
* Install HyperFlow: <br>`npm install https://github.com/hyperflow-wms/hyperflow/archive/v1.3.0.tar.gz`
* For latest features, install from the master branch: Install HyperFlow:<br>`npm install https://github.com/hyperflow-wms/hyperflow/archive/master.tar.gz
* Add `<install_root>/node_modules/.bin` to your path

### Running
* Start the redis server: `redis-server`
* Run example workflows using command `hflow run <wf_directory>`, for example:<br>```hflow run ./examples/Sqrsum```

## Using Docker image
* Use the latest Docker image for the HyperFlow engine, published in Docker Hub as `hyperflowwms/hyperflow`, OR 
* Build the image yourself: `docker build -t hyperflow .`
* Start redis container: `docker run --name redis -d redis`
    * [OPTIONAL] If you plan on using amqp executor, start a RabbitMQ container: `docker run -d --name rabbitmq rabbitmq:3`
* Run the HyperFlow server container: `docker run -d --rm --link=redis -e "REDIS_URL=redis://redis" --name hyperflow -p 8080:80 hyperflow`
    * [OPTIONAL] or with amqp executor: `docker run -d --rm --link=rabbitmq --link=redis -e "AMQP_URL=amqp://rabbitmq" -e "REDIS_URL=redis://redis" --name hyperflow -p 8080:80 hyperflow`
* Verify that the server responds with: `curl localhost:8080 -v`, the output should contain a string: `Cannot GET /`

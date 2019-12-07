# HyperFlow: a scientific workflow execution engine

## Description

HyperFlow is a Workflow Management System (WMS) dedicated for scientific workflows. 

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more about the HyperFlow workflow model. 

## Getting started

The latest release of HyperFlow is 1.3.0

### Installation
* Install Node.js (http://nodejs.org)
* Install Redis (http://redis.io) 
* Install HyperFlow:<br>`npm install https://github.com/hyperflow-wms/hyperflow/archive/v1.2.0.tar.gz`

### Running
* Start the redis server: `redis-server`
* Go to hyperflow directory: `cd node_modules/hyperflow`
* Run example workflows using command `hflow run <wf_directory>`, for example:<br>```./bin/hflow run ./examples/Sqrsum```
* Optionally, you can add directory `<hyperflow_root_dir>/bin` to your system `PATH`

## Using Docker image
* Use the latest Docker image for the HyperFlow engine, published in Docker Hub as `hyperflowwms/hyperflow`, OR 
* Build the image yourself: `docker build -t hyperflow .`
* Start redis container: `docker run --name redis -d redis`
    * [OPTIONAL] If you plan on using amqp executor, start a RabbitMQ container: `docker run -d --name rabbitmq rabbitmq:3`
* Run the HyperFlow server container: `docker run -d --rm --link=redis -e "REDIS_URL=redis://redis" --name hyperflow -p 8080:80 hyperflow`
    * [OPTIONAL] or with amqp executor: `docker run -d --rm --link=rabbitmq --link=redis -e "AMQP_URL=amqp://rabbitmq" -e "REDIS_URL=redis://redis" --name hyperflow -p 8080:80 hyperflow`
* Verify that the server responds with: `curl localhost:8080 -v`, the output should contain a string: `Cannot GET /`

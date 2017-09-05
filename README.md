#HyperFlow: a distributed workflow execution engine

##Description

HyperFlow provides a model of computation, workflow description language and enactment engine for complex, distributed workflows.

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more about the HyperFlow workflow model. 

##Getting started

The latest release of HyperFlow is 1.1.0

###Installation
* Install Node.js (http://nodejs.org)
* Install Redis (http://redis.io) 
* Install HyperFlow:<br>`npm install https://github.com/dice-cyfronet/hyperflow/archive/1.1.0.tar.gz`

###Running
* Start the redis server: `redis-server`
* Go to hyperflow directory: `cd node_modules/hyperflow`
* Run example workflows using command `hflow run <wf_directory>`, for example:<br>```./bin/hflow run ./examples/Sqrsum```
* Optionally, you can add directory `<hyperflow_root_dir>/bin` to your system `PATH`

###Using docker image
* Build the image: `docker build -t hyperflow .`
* Start redis container: `docker run --name redis -d redis`
    * [OPTIONAL] If you plan on using amqp executor, start a rabbitmq container: `docker run -d --name rabbitmq rabbitmq:3`
* Run hyperflow server: `docker run -d --rm --link=redis -e "REDIS_URL=redis://redis" --name hyperflow -p 8080:80 hyperflow`
    * [OPTIONAL] or with amqp executor: `docker run -d --rm --link=rabbitmq --link=redis -e "AMQP_URL=amqp://rabbitmq" -e "REDIS_URL=redis://redis" --name hyperflow -p 8080:80 hyperflow`
* Verify that the server responds with: `curl localhost:8080 -v`, the output should contain a string: `Cannot GET /`
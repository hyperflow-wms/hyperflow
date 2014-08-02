#HyperFlow: a distributed workflow execution engine

##Description

HyperFlow provides a model of computation, workflow description language and enactment engine for complex, distributed workflows.

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more about the HyperFlow workflow model. 

##Getting started

The latest release of HyperFlow is 1.0.0

###Installation
* Download the package: https://github.com/dice-cyfronet/hyperflow/archive/v1.0.0.zip
* Install dependencies (in `hyperflow` directory): `npm install -d`
* Install the latest node.js (http://nodejs.org)
* Install the Redis server 2.6.x or higher (http://redis.io) (tested with version 2.6.x)
* Start the redis server.
* Set an environment variable `HFLOW_PATH` to point to your hyperflow root directory.
* Add `$HFLOW_PATH/bin` to your `PATH`.

###Running
Run example workflows from the `examples` directory as follows: 

```hflow run <wf_directory>```

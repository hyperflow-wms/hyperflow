#HyperFlow: a distributed workflow execution engine

##Description

HyperFlow provides a model of computation and an execution engine for complex, distributed workflow applications which consist of a set of **processes** performing well-defined **functions** and exchanging **signals**.

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more about the HyperFlow workflow model. 

##Getting started

Currently the recommended way to try HyperFlow is as follows:
* Clone the hyperflow repository
* Install dependencies (in `hyperflow` directory): `npm install -d`
* Get the latest node.js (http://nodejs.org)
* Get the latest Redis server (http://redis.io)
* Start the redis server
* Run example workflows in the `test` directory, e.g. `node splitter.test.js`
* Look at sample workflows in the `workflows` directory
* Look at example functions invoked from workflow tasks in the `functions` directory



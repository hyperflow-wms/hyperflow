#HyperFlow: a distributed workflow execution engine

##Description

HyperFlow provides a model of computation and an execution engine for complex, distributed workflow applications which consist of a set of **processes** performing well-defined **functions** and exchanging **signals**.

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more about the HyperFlow workflow model. 

##Getting started

Latest release of HyperFlow is 1.0.0-beta-4

Installation & running:
* Download the package: https://github.com/dice-cyfronet/hyperflow/archive/v1.0.0-beta-4.zip
* Install dependencies (in `hyperflow` directory): `npm install -d`
* Install the latest node.js (http://nodejs.org)
* Install the Redis server 2.6.x or higher (http://redis.io) (tested with version 2.6.x)
* Start the redis server
* Run example workflows: `node scripts/runwf.js -f workflows/<workflow_file>`
  * Try `Wf_grepfile_simple.json`, `Wf_MapReduce.json`, `Wf_PingPong.json`
* Also try simulated `Montage` workflows which require the `-s` flag: 
  * `node scripts/runwf.js -f workflows/Montage_143.json -s`
* Look at sample workflows in the `workflows` directory
* Look at example functions invoked from workflow tasks in the `functions` directory


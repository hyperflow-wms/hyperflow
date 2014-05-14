# HyperFlow: a distributed workflow execution engine

## Description

HyperFlow provides a model of computation and an execution engine for complex, distributed [workflow](http://en.wikipedia.org/wiki/Workflow) applications which consist of a set of **processes** performing well-defined **functions** and exchanging **signals**. Browse the [wiki pages](https://github.com/dice-cyfronet/hyperflow/wiki) to learn more about the HyperFlow workflow model. 


## Getting started

### Installing Hyperflow

Hyperflow requires [node.js](http://nodejs.org) runtime and may be installed using npm package manager:

```shell
$ npm install -g hyperflow
```

Hyperflow also requires [Redis](http://redis.io) server.

```shell
# on Debian/Ubuntu
$ sudo apt-get install redis-server

# on RedHat or CentOS
$ sudo yum install redis 
```

### Running *hello world* workflow

```shell
$ git clone http://github.com/dice-cyfronet/hyperflow-hello-world
$ cd hyperflow-hello-world
$ hyperflow start
Hyperflow starting!
Listening on *:1234, webui: http://1.2.3.4:1234/
hello-world workflow loaded, sending initial signals.
... to be continued
```
### Advanced options

```
hyperflow start [--functions functions.js] [--dag dag.json|dag.js] [--config hyperflow.json] [--config-KEY=VALUE]
````


### Workflow directory structure

Workflow is a directory that bundles all files required and contains:

* workflow DAG:
  * `dag.json` – static workflow DAG in JSON, or
  * `dag.js` – DAG generation code as node.js module, 
* `hyperflow.json` – hyperflow configuration and workflow parameters,
* `functions.js` – functions specific for given workflow.

## Configuration

Configuration is provided in JSON format, while some options may be also specified as environment variables. Hyperflow reads and merges the config in the following order:

* defaults (see [default_config.json](default_config.json)),
* `/etc/hyperflow.json`,
* `~/.hyperflow.json`,
* `hyperflow.json` placed in the same directory as workflow JSON file,
* `$HYPERFLOW_CONFIG`,
* options from environment variables e.g. `$REDIS_URL`,
* options from command line arguments.

Options are:

* `port` or `$PORT` (defaults to 1234)
* `redis_url` or `$REDIS_URL` (defaults to: `redis://127.0.0.1:6379/0`)
* `amqp_url` or `$AMQP_URL` (defaults to `amqp://localhost`)
* `amqp_executor_config` (defaults to `{"storage": "local", "workdir": "/tmp/"}`)

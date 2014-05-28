# HyperFlow: a distributed workflow execution engine

HyperFlow provides a model of computation and an execution engine for complex, distributed [workflow](http://en.wikipedia.org/wiki/Workflow) applications which consist of a set of **processes** performing well-defined **functions** and exchanging **signals**. Browse the [wiki pages](https://github.com/dice-cyfronet/hyperflow/wiki) to learn more about the HyperFlow workflow model. 


## Getting started

### Installing Hyperflow

Hyperflow requires [node.js](http://nodejs.org) runtime. Stable version may be installed using npm package manager:

```shell
$ npm install -g hyperflow
```

You can install bleeding-edge from GitHub:

```shell
$ npm install -g https://github.com/dice-cyfronet/hyperflow/archive/develop.tar.gz
```

Hyperflow also requires [Redis](http://redis.io) server.

```shell
# on Debian/Ubuntu
$ sudo apt-get install redis-server

# on RedHat or CentOS
$ sudo yum install redis 
```

### Installing additional modules

`hyperflow` package provides only core functionality, while additional packages extend it to provide additional *functions*. The functions may be later referenced from workflow graph as `$npm_package_name:$function_name`.

We provide:

* `hyperflow-amqp` – allows remote execution of tasks by using AMQP queues,
* `hyperflow-map-reduce` – functions for constructing Map-Reduce workflows.

See [wiki page](http://...) to see how to create hyperflow function packages. 

### Running *hello world* workflow

```shell
$ git clone http://github.com/dice-cyfronet/hyperflow-hello-world.git
$ cd hyperflow-hello-world
$ hflow start
Hyperflow starting!
Listening on *:1234, webui: http://1.2.3.4:1234/
hello-world workflow loaded, sending initial signals.
Workflow id is 9876.
```
### Advanced options

```
hflow start [--background] [--functions functions.js] [--dag graph.json|graph.js] [--config config.json] [--set-KEY=VALUE] 
hflow resume [workflow_id] [--functions functions.js] [--dag graph.json|graph.js] [--config config.json] [--set-KEY=VALUE]
hflow terminate [workflow_id]
hflow status [workflow_id]
hflow watch_events [workflow_id]
```

### Workflow directory structure

Workflow is a directory that bundles all files required and contains:

* workflow graph:
  * `graph.json` – static workflow graph in JSON, or
  * `graph.js` – graph generation code as node.js module, 
* `config.json` – hyperflow configuration and workflow parameters,
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

* `packages` – list of function packages that are required by workflow
* `port` or `$PORT` (defaults to 1234)
* `redis_url` or `$REDIS_URL` (defaults to: `redis://127.0.0.1:6379/0`)
* `amqp_url` or `$AMQP_URL` (defaults to `amqp://localhost`)
* `amqp_executor_config` (defaults to `{"storage": "local", "workdir": "/tmp/"}`)

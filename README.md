#HyperFlow: a distributed workflow execution engine

##Description

HyperFlow allows one to execute workflows defined as a collection of tasks connected through input and output ports. The internal workflow model of HyperFlow is based on Discrete-Event Dynamic Systems and Finite State Machines theory.   

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

##Workflow model
HyperFlow provides simple yet expressive abstraction for constructing a workflow. Basically this abstraction contains only one construct: a workflow **Task**. A task has: 
* **Input ports** which consume signals, 
* **Output ports** which emit signal,
* a **Function** which is invoked from the task in order to transform data inputs into data outputs. 

Imprtantly, two types of signals are distinguished: 
* **Data signals** which denote a data flow between tasks and carry additional information about data elements (such as name, type, path to a file, an URI, or simply a value); 
* **Control signals** which only are present or not, and are associated with no additional information except for a name and id. 

Consequently, ports associated with a data or control signal are called, respectively, **data ports** or **control ports**.

A workflow is simply **a set of tasks connected through ports**. 

This simple abstraction provides a workflow model sufficient to express many data and control flow patterns (including loops) thanks to one additional element: a **task Type**. The task type determines task inner "dynamics", i.e. the way how exactly the inputs are processed, when and how many times the function is invoked etc. 

Study this [simple example](https://github.com/balis/hyperflow/wiki/First-workflow) for a quick introduction to workflow types and workflow format.

Browse the [wiki pages](https://github.com/balis/hyperflow/wiki) to learn more. 


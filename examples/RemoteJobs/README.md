## Distributed execution of workflow Jobs using Redis
This example explains the distributed execution model of Hyperflow. It demonstrates how HyperFlow can communicate with remote job executors using Redis. It is also useful for testing the implementation of the [Hyperflow job executor](https://github.com/hyperflow-wms/hyperflow-job-executor).

The distributed execution architecture consists of:
1. Master components:
   - **The Hyperflow engine** - executes the workflow graph; for each workflow task it invokes the **Job invoker** function
   - **Job invoker** - Javascript function which creates jobs on a (remote) infrastructure to execute workflow tasks
   - **Redis server** - used for communication between the Hyperflow engine and Job executors on remote workers
 1. Worker components:
    - **Hyperflow job executor** - receives the job command from the Hyperflow engine and spawns application software
    - **Application software** - software that actually performs workflow tasks

In this example:
 - The workflow invokes function `submitRemoteJob` (Job invoker) from `functions.js` 100 times. This function simulates submission of jobs by starting 100 parallel processes of `node handler.js  <taskId> <redis_url>`.
 - `../../../hyperflow-job-executor/handler.js` represents a remote job executor which is passed two parameters: `taskId` and `redis_url`. 
 - `handler.js` gets a `jobMessage` from HyperFlow, and then sends back a notification that the job has completed; `taskId` is used to construct appropriate Redis keys for this communication.
 - On the HyperFlow engine side, the Job invoker can use two functions (provided by Hyperflow): `context.sendMsgToJob` to send a message to the job, and `context.jobResult` to wait for the notification. These functions return a [`Promise`](https://javascript.info/promise-basics), so the async/await syntax can be used as shown in the example.
 - The parameter to the `context.jobResult` function is a timeout in seconds (0 denotes infinity). One can use a retry library, such as [promise-retry](https://www.npmjs.com/package/promise-retry), to implement an exponential retry strategy.
 - The Job invoker also gets the Redis URL in `context.redis_url` which can be passed to the remote job executors.
 
 To run the workflow, execute the following commands:
 1. First, clone the Hyperflow engine and the Hyperflow job executor:
    - `git clone https://github.com/hyperflow`
    - `git clone https://github.com/hyperflow-wms/hyperflow-job-executor`
    - `cd hyperflow; npm install`
    - `cd ../hyperflow-job-executor; npm install`
 1. Start the redis server
 1. To run the workflow:
    - `cd ../hyperflow/examples/RemoteJobs`
    - `npm install` (once)
    - `hflow run .`
 

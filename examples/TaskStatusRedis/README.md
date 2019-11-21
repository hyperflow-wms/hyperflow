## Communication with remote Jobs using Redis
This example demonstrates how HyperFlow can communicate with remote job executors using Redis. 

 - The workflow invokes function `job_status_redis_test` from `functions.js` 100 times. This function simulates submission of jobs by starting 100 parallel processes of `handler.js`.
 - `handler.js` represents a remote job executor which is passed two parameters: `taskId` and `redis_url`. 
 - `handler.js` gets `jobMessage` from Redis, and then sends back a notification that the job has completed; `taskId` is used to construct appropriate Redis keys.
 - On the HyperFlow engine side, the Process Function can use two functions: `context.sendMsgToJob` to send a message to the job, and `context.taskStatus` to wait for the notification. These functions return a [`Promise`](https://javascript.info/promise-basics), so the async/await syntax can be used as shown in the example.
 - The parameter to the `context.taskStatus` function is a timeout in seconds (0 denotes infinity). One can use a retry library, such as [promise-retry](https://www.npmjs.com/package/promise-retry), to implement an exponential retry strategy.
 - The Process Function also gets the Redis URL in `context.redis_url` which can be passed to the remote job executors.
 
 To run the workflow, simply do `hflow run .` in this directory. You might need to run once `npm install` to install dependencies.
 

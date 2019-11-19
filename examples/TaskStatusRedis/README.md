## Job notification mechanism example
This example demonstrates how remote job executors can notify the HyperFlow engine about job completion using Redis. 

 - The workflow invokes function `task_status_redis_test` from `functions.js` 100 times. This function simulates submission of jobs by starting 100 parallel processes of `handler.js`.
 - `handler.js` represents a remote job executor which is passed two parameters: `taskId` and `redis_url`. 
 - In order to notify that the job has completed, `handler.js` connects to Redis and performs a `RPUSH` operation on the `taskId` key.
 - On the HyperFlow engine side, the Process Function is passed `context.taskStatus` function which can be used to wait for the notification. This function returns a [`Promise`](https://javascript.info/promise-basics), so the async/await syntax can be used as shown in the example.
 - The parameter to the `context.taskStatus` function is a timeout in seconds (0 denotes infinity). One can use a retry library, such as [promise-retry](https://www.npmjs.com/package/promise-retry), to implement an exponential retry strategy.
 

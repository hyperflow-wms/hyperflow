
/**
 * Class for getting notifications about tasks' results.
 */
class RemoteJobConnector {
    /**
     * Constructor.
     * @param {RedisClient} redisClient redis client
     * @param {string} wfId workflow ID
     * @param {number} checkInterval loop interval in ms.
     */
    constructor(redisClient, wfId, checkInterval) {
        this.jobPromiseResolves = {};
        this.rcl = redisClient;
        this.running = false;
        this.completedNotificationQueueKey = "wf:" + wfId + ":tasksPendingCompletionHandling";
        this.checkInterval = checkInterval;
    }

    /**
     * Gives promise, that will be resolved on remote
     * job completion.
     * @param {*} taskId task ID
     */
    waitForTask(taskId) {
        if (this.jobPromiseResolves[taskId] !== undefined) {
            console.error("[RemoteJobConnector] Task", taskId, "is already observed");
            return;
        }
        console.log("[RemoteJobConnector] Waiting for task", taskId);
        let promise = new Promise((resolve, reject) => {
            this.jobPromiseResolves[taskId] = resolve;
        });

        return promise;
    }

    /**
     * Runs connector, that fetches notifications about
     * task completions, then makes relevant waiting promises
     * resolved.
     */
    async run() {
        this.running = true;
        while (true) {
            if (this.running == false) {
                console.log("[RemoteJobConnector] Stopping");
                break;
            }

            let taskId = null;
            try {
                taskId = await this.rcl.sRandMember(this.completedNotificationQueueKey);
            } catch (error) {
                console.error("[RemoteJobConnector] Unable to fetch new completed jobs", error);
            }

            if (taskId == null) {
                await new Promise((resolve) => setTimeout(resolve, this.checkInterval));
                continue;
            }

            console.log("[RemoteJobConnector] Got completed job:", taskId);

            let taskResult = null;
            try {
                let reply = await this.rcl.sPop(taskId);
                /* Wrap results into array to preserve
                * compatibility with blpop format. */
                taskResult = [null, reply];
            } catch (error) {
                console.error(error);
                console.error("[RemoteJobConnector] Unable to get result of job", taskId);
                continue;
            }

            if (this.jobPromiseResolves[taskId] === undefined) {
                console.error("[RemoteJobConnector] Observer for task", taskId, "not found");
                continue;
            }
            let promiseResolve = this.jobPromiseResolves[taskId];
            delete this.jobPromiseResolves[taskId];

            try {
                let reply = await this.rcl.sRem(this.completedNotificationQueueKey, taskId);
            } catch (error) {
                console.error("[RemoteJobConnector] Unable to delete job from completed queue", error);
            }

            console.log("[RemoteJobConnector] Resolving promise for task", taskId, "| result =", taskResult);
            promiseResolve(taskResult);
        }

        return;
    }

    /**
     * Stops connector.
     */
    async stop() {
        console.log("[RemoteJobConnector] Requesting stop");
        this.running = false;
        return;
    }
}

module.exports = RemoteJobConnector

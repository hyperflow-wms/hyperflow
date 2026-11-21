const taskLabel = require('../common/taskLabel').taskLabel;
const clog = require('../common/consoleLogger');

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
        this.taskNames = {}; // taskId -> task/job type name (e.g. "mProject"), for logging
        this.handledTasks = new Set(); // tasks whose completion was already delivered
        // taskId -> code from resolveTask() before waitForTask() registered.
        // Completion notices that arrive early stay in redis instead.
        this.earlyEvents = {};
        this.rcl = redisClient;
        this.running = false;
        this.completedNotificationQueueKey = "wf:" + wfId + ":tasksPendingCompletionHandling";
        this.checkInterval = checkInterval;
    }

    /**
     * Formats a task ID for logging, appending its job/task type name when known.
     * @param {*} taskId task ID
     */
    describeTask(taskId) {
        return taskLabel(taskId, this.taskNames[taskId]);
    }

    /**
     * Gives promise, that will be resolved on remote
     * job completion.
     * @param {*} taskId task ID
     * @param {string} [name] task/job type name (e.g. "mProject"), for logging
     */
    waitForTask(taskId, name) {
        if (this.jobPromiseResolves[taskId] !== undefined) {
            clog.warn("[RemoteJobConnector] Task", this.describeTask(taskId), "is already observed");
            return;
        }
        if (name) this.taskNames[taskId] = name;

        if (this.earlyEvents[taskId] !== undefined) {
            const code = this.earlyEvents[taskId];
            delete this.earlyEvents[taskId];
            this.handledTasks.add(taskId);
            clog.debug("[RemoteJobConnector] Resolving promise for task", this.describeTask(taskId),
                "| result =", [null, code], "(resolved by the engine before the wait started)");
            delete this.taskNames[taskId];
            return Promise.resolve([null, code]);
        }

        clog.debug("[RemoteJobConnector] Waiting for task", this.describeTask(taskId));
        let promise = new Promise((resolve, reject) => {
            this.jobPromiseResolves[taskId] = resolve;
        });

        return promise;
    }

    /**
     * Ends the wait for a task with an exit code set by the engine itself
     * instead of a job executor, e.g. when the task's Kubernetes Job could
     * not be created. The waiting promise resolves as on a completion
     * notice, so a later waitForTask() for the same task (a restart) starts
     * a new wait. If no wait has started yet, the next waitForTask() for
     * the task returns this result at once.
     * @param {*} taskId task ID
     * @param {number|string} code exit code
     */
    resolveTask(taskId, code) {
        code = String(code);
        const promiseResolve = this.jobPromiseResolves[taskId];
        if (promiseResolve === undefined) {
            if (this.earlyEvents[taskId] === undefined) {
                clog.debug("[RemoteJobConnector] Result", code, "for task", this.describeTask(taskId),
                    "set before its wait started, keeping it");
                this.earlyEvents[taskId] = code;
            }
            return;
        }
        delete this.jobPromiseResolves[taskId];
        this.handledTasks.add(taskId);
        clog.debug("[RemoteJobConnector] Resolving promise for task", this.describeTask(taskId),
            "| result =", [null, code], "(resolved by the engine)");
        delete this.taskNames[taskId];
        promiseResolve([null, code]);
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
                clog.debug("[RemoteJobConnector] Stopping");
                break;
            }

            let taskId = null;
            try {
                taskId = await new Promise((resolve, reject) => {
                    this.rcl.srandmember(this.completedNotificationQueueKey, function(err, reply) {
                        err ? reject(err): resolve(reply);
                    });
                });
            } catch (error) {
                clog.error("[RemoteJobConnector] Unable to fetch new complated jobs", error);
            }

            if (taskId == null) {
                await new Promise((resolve) => setTimeout(resolve, this.checkInterval));
                continue;
            }

            if (this.jobPromiseResolves[taskId] === undefined) {
                if (this.handledTasks.has(taskId)) {
                    // Duplicate notification for an already handled task (e.g.
                    // executor retry or message redelivery): remove it, otherwise
                    // it stays in the notification set forever.
                    clog.warn("[RemoteJobConnector] Task", this.describeTask(taskId),
                        "already handled, removing duplicate notification");
                    try {
                        await new Promise((resolve, reject) => {
                            this.rcl.srem(this.completedNotificationQueueKey, taskId, function(err, reply) {
                                err ? reject(err): resolve(reply);
                            });
                        });
                    } catch (error) {
                        console.error("[RemoteJobConnector] Unable to delete job from completed queue", error);
                    }
                } else {
                    // The notification may have arrived before waitForTask()
                    // registered the observer. Keep it (and the task result)
                    // intact for a later iteration, but back off instead of
                    // busy-polling redis.
                    clog.debug("[RemoteJobConnector] Observer for task", this.describeTask(taskId), "not found");
                    await new Promise((resolve) => setTimeout(resolve, this.checkInterval));
                }
                continue;
            }

            clog.debug("[RemoteJobConnector] Got completed job:", this.describeTask(taskId));

            let taskResult = null;
            try {
                taskResult = await new Promise((resolve, reject) => {
                    this.rcl.spop(taskId, function(err, reply) {
                        /* Wrap results into array to preserve
                         * compatibility with blpop format. */
                        let replyArr = [null, reply];
                        err ? reject(err): resolve(replyArr);
                    });
                });
            } catch (error) {
                clog.error("[RemoteJobConnector] Unable to get result of job", taskId);
                continue;
            }

            // Read the observer again: resolveTask() may have ended the wait
            // while SPOP was in flight. Then the result has no wait to go to
            // and is discarded, but the notification is still removed below.
            let promiseResolve = this.jobPromiseResolves[taskId];
            delete this.jobPromiseResolves[taskId];
            this.handledTasks.add(taskId);
            if (promiseResolve === undefined) {
                clog.warn("[RemoteJobConnector] Completion for task", this.describeTask(taskId),
                    "| result =", taskResult, "arrived after its wait had ended, discarding it");
            }

            try {
                await new Promise((resolve, reject) => {
                    this.rcl.srem(this.completedNotificationQueueKey, taskId, function(err, reply) {
                        err ? reject(err): resolve(reply);
                    });
                });
            } catch (error) {
                console.error("[RemoteJobConnector] Unable to delete job from completed queue", error);
            }

            if (promiseResolve === undefined) {
                continue;
            }

            clog.debug("[RemoteJobConnector] Resolving promise for task", this.describeTask(taskId), "| result =", taskResult);
            delete this.taskNames[taskId];
            promiseResolve(taskResult);
        }

        return;
    }

    /**
     * Stops connector.
     */
    async stop() {
        clog.debug("[RemoteJobConnector] Requesting stop");
        this.running = false;
        return;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses the raw nested-array reply of XREADGROUP (node_redis v3 does not
 * decode stream replies) into a flat list of { id, taskId, code } entries
 * for the given stream key.
 *
 * Reply shape: [ [ streamKey, [ [ id, [f1, v1, f2, v2, ...] ], ... ] ], ... ]
 * or a bare `null` when a BLOCKing read times out with nothing new.
 *
 * @param {*} reply raw XREADGROUP reply
 * @param {string} streamKey the stream key we asked for
 */
function parseStreamReply(reply, streamKey) {
    if (!reply) return [];
    for (const streamEntry of reply) {
        if (!streamEntry) continue;
        const key = streamEntry[0];
        const entries = streamEntry[1];
        if (key !== streamKey) continue;
        return (entries || []).map((entry) => {
            const id = entry[0];
            const fieldsFlat = entry[1] || [];
            const fields = {};
            for (let i = 0; i < fieldsFlat.length; i += 2) {
                fields[fieldsFlat[i]] = fieldsFlat[i + 1];
            }
            return { id: id, taskId: fields.taskId, code: fields.code };
        });
    }
    return [];
}

/**
 * Class for getting notifications about tasks' results over a per-engine-
 * process Redis Stream (consumer group), replacing the legacy shared-set
 * polling protocol implemented by RemoteJobConnector above.
 *
 * One instance serves the whole engine process (all workflows it runs),
 * not one per workflow: observers are keyed by the full taskId
 * (hfId:wfId:procId:firingId), which is globally unique across workflows,
 * so demultiplexing between workflows is free.
 */
class StreamRemoteJobConnector {
    /**
     * Constructor.
     * @param {RedisClient} blockingRedisClient a *dedicated* redis client
     *   (e.g. rcl.duplicate()) used for the blocking XREADGROUP loop. Must
     *   not be the engine's shared client, or a blocking read would stall
     *   every other Redis operation on it.
     * @param {string} hfId this engine process' global id
     */
    constructor(blockingRedisClient, hfId) {
        this.jobPromiseResolves = {};
        this.taskNames = {}; // taskId -> task/job type name (e.g. "mProject"), for logging
        this.handledTasks = new Set(); // tasks whose completion was already delivered
        this.earlyEvents = {}; // taskId -> code, for events (or resolveTask() results) that arrived before waitForTask() registered
        this.rcl = blockingRedisClient;
        this.hfId = hfId;
        this.streamKey = "hf:" + hfId + ":completions";
        this.group = "engine";
        this.consumer = "main";
        this.running = false;
    }

    /**
     * Formats a task ID for logging, appending its job/task type name when known.
     * @param {*} taskId task ID
     */
    describeTask(taskId) {
        return taskLabel(taskId, this.taskNames[taskId]);
    }

    /**
     * Gives promise, that will be resolved on remote
     * job completion.
     * @param {*} taskId task ID
     * @param {string} [name] task/job type name (e.g. "mProject"), for logging
     */
    waitForTask(taskId, name) {
        if (this.jobPromiseResolves[taskId] !== undefined) {
            clog.warn("[StreamRemoteJobConnector] Task", this.describeTask(taskId), "is already observed");
            return;
        }
        if (name) this.taskNames[taskId] = name;

        if (this.earlyEvents[taskId] !== undefined) {
            // The event already arrived (and was XACK'd) before this observer
            // registered - resolve immediately, no need to touch redis again.
            const code = this.earlyEvents[taskId];
            delete this.earlyEvents[taskId];
            this.handledTasks.add(taskId);
            clog.debug("[StreamRemoteJobConnector] Resolving promise for task", this.describeTask(taskId),
                "| result =", [null, code], "(early arrival)");
            delete this.taskNames[taskId];
            return Promise.resolve([null, code]);
        }

        clog.debug("[StreamRemoteJobConnector] Waiting for task", this.describeTask(taskId));
        let promise = new Promise((resolve, reject) => {
            this.jobPromiseResolves[taskId] = resolve;
        });

        return promise;
    }

    /**
     * Ends the wait for a task with an exit code set by the engine itself
     * instead of a job executor, e.g. when the task's Kubernetes Job could
     * not be created. The waiting promise resolves as on a completion
     * event, so a later waitForTask() for the same task (a restart) starts
     * a new wait. If no wait has started yet, the result is kept as an
     * early event, unless one is already kept, and the next waitForTask()
     * for the task returns it at once.
     * @param {*} taskId task ID
     * @param {number|string} code exit code
     */
    resolveTask(taskId, code) {
        code = String(code);
        const promiseResolve = this.jobPromiseResolves[taskId];
        if (promiseResolve === undefined) {
            if (this.earlyEvents[taskId] === undefined) {
                clog.debug("[StreamRemoteJobConnector] Result", code, "for task", this.describeTask(taskId),
                    "set before its wait started, keeping it");
                this.earlyEvents[taskId] = code;
            }
            return;
        }
        delete this.jobPromiseResolves[taskId];
        this.handledTasks.add(taskId);
        clog.debug("[StreamRemoteJobConnector] Resolving promise for task", this.describeTask(taskId),
            "| result =", [null, code], "(resolved by the engine)");
        delete this.taskNames[taskId];
        promiseResolve([null, code]);
    }

    /**
     * Creates the consumer group (once), tolerating it already existing.
     */
    _createGroup() {
        return new Promise((resolve, reject) => {
            this.rcl.xgroup(['CREATE', this.streamKey, this.group, '0', 'MKSTREAM'], (err, reply) => {
                if (err) {
                    if (err.code === 'BUSYGROUP' || /BUSYGROUP/.test(String(err.message || err))) {
                        resolve('BUSYGROUP');
                        return;
                    }
                    reject(err);
                    return;
                }
                resolve(reply);
            });
        });
    }

    /**
     * Issues one XREADGROUP call.
     * @param {string} id '>' for new entries, '0' to replay this consumer's PEL
     * @param {boolean} block whether to include BLOCK 5000 (only used with id === '>')
     */
    _readGroup(id, block) {
        return new Promise((resolve, reject) => {
            const args = ['GROUP', this.group, this.consumer, 'COUNT', 128];
            if (block) args.push('BLOCK', 5000);
            args.push('STREAMS', this.streamKey, id);
            this.rcl.xreadgroup(args, (err, reply) => {
                err ? reject(err) : resolve(reply);
            });
        });
    }

    /**
     * Batch-acknowledges a list of entry ids.
     */
    _ack(ids) {
        if (!ids || ids.length === 0) return Promise.resolve(0);
        return new Promise((resolve, reject) => {
            this.rcl.xack([this.streamKey, this.group].concat(ids), (err, reply) => {
                err ? reject(err) : resolve(reply);
            });
        });
    }

    /**
     * Resolves the matching observer, stashes an early event, or drops a
     * duplicate, for one parsed stream entry.
     */
    _handleEntry(taskId, code) {
        if (this.jobPromiseResolves[taskId] !== undefined) {
            let promiseResolve = this.jobPromiseResolves[taskId];
            delete this.jobPromiseResolves[taskId];
            this.handledTasks.add(taskId);
            clog.debug("[StreamRemoteJobConnector] Resolving promise for task", this.describeTask(taskId),
                "| result =", [null, code]);
            delete this.taskNames[taskId];
            promiseResolve([null, code]);
        } else if (this.handledTasks.has(taskId)) {
            clog.warn("[StreamRemoteJobConnector] Task", this.describeTask(taskId),
                "already handled, dropping duplicate notification");
        } else if (this.earlyEvents[taskId] !== undefined) {
            clog.warn("[StreamRemoteJobConnector] Duplicate early notification for task",
                this.describeTask(taskId), "before observer registered, keeping first result");
        } else {
            clog.debug("[StreamRemoteJobConnector] Early notification for task", this.describeTask(taskId),
                "- observer not yet registered, stashing");
            this.earlyEvents[taskId] = code;
        }
    }

    /**
     * Drains this consumer's PEL (entries delivered on a previous run of
     * this same hfId's stream but never XACK'd, e.g. a crash between
     * delivery and ack). Defensive: hfId is a fresh shortid per engine
     * process, so in practice the PEL is empty at startup.
     */
    async _drainPel() {
        while (this.running) {
            let reply;
            try {
                reply = await this._readGroup('0', false);
            } catch (error) {
                clog.error("[StreamRemoteJobConnector] PEL drain failed, retrying", error);
                await sleep(500);
                continue;
            }
            const entries = parseStreamReply(reply, this.streamKey);
            if (entries.length === 0) break;

            clog.debug("[StreamRemoteJobConnector] Redelivering", entries.length,
                "unacknowledged entr" + (entries.length === 1 ? "y" : "ies"), "from PEL");
            for (const entry of entries) {
                this._handleEntry(entry.taskId, entry.code);
            }
            try {
                await this._ack(entries.map((e) => e.id));
            } catch (error) {
                clog.error("[StreamRemoteJobConnector] XACK failed during PEL drain", error);
            }
        }
    }

    /**
     * Runs connector: creates the consumer group, drains any leftover PEL,
     * then loops XREADGROUP on new entries until stopped.
     */
    async run() {
        this.running = true;

        try {
            await this._createGroup();
        } catch (error) {
            clog.error("[StreamRemoteJobConnector] Unable to create consumer group", this.group,
                "on", this.streamKey, error);
        }

        await this._drainPel();

        while (this.running) {
            let reply;
            try {
                reply = await this._readGroup('>', true);
            } catch (error) {
                clog.error("[StreamRemoteJobConnector] XREADGROUP failed, retrying", error);
                await sleep(500);
                continue;
            }

            const entries = parseStreamReply(reply, this.streamKey);
            if (entries.length === 0) continue;

            for (const entry of entries) {
                this._handleEntry(entry.taskId, entry.code);
            }

            try {
                await this._ack(entries.map((e) => e.id));
            } catch (error) {
                clog.error("[StreamRemoteJobConnector] XACK failed", error);
            }
        }

        clog.debug("[StreamRemoteJobConnector] Stopping");
        return;
    }

    /**
     * Stops connector. Since the read loop blocks for at most BLOCK=5000ms
     * at a time, this is observed on the next loop iteration (same
     * semantics as the legacy connector's finite checkInterval sleep).
     */
    async stop() {
        clog.debug("[StreamRemoteJobConnector] Requesting stop");
        this.running = false;
        return;
    }
}

/**
 * Starts a connector's completion loop (its run()). The loop is the only
 * path by which task completions reach the engine, so if it stops on an
 * unexpected error no waiting task could ever complete: the error is logged
 * and the engine exits with status 1.
 * @param {RemoteJobConnector|StreamRemoteJobConnector} connector
 * @returns {Promise} settles when the loop ends
 */
function startCompletionLoop(connector) {
    const name = connector.constructor.name;
    return connector.run().catch((error) => {
        clog.error("[" + name + "] Completion loop stopped on an unexpected error, exiting with status 1:", error);
        process.exit(1);
    });
}

module.exports = RemoteJobConnector
module.exports.StreamRemoteJobConnector = StreamRemoteJobConnector
module.exports.startCompletionLoop = startCompletionLoop

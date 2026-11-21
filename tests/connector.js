/**
 * Regression tests for wflib/connector.js: both the legacy set-polling
 * RemoteJobConnector and the new stream-based StreamRemoteJobConnector.
 *
 * Legacy section (unchanged) covers three defects fixed in the
 * observer-not-found path:
 *  1. a completion notification for an unobserved task was never SREM'd from
 *     the notification set (stayed there forever);
 *  2. drawing such a notification skipped the checkInterval sleep, so the
 *     poll loop busy-polled redis at maximum rate;
 *  3. the task result was SPOP'd *before* the observer check, so a
 *     notification arriving just before waitForTask() registered destroyed
 *     the exit code.
 *
 * Stream section covers StreamRemoteJobConnector: normal completion,
 * duplicate drop, early-arrival, burst draining (COUNT 128), demux across
 * workflows sharing one process-wide connector, and PEL redelivery across a
 * simulated engine restart.
 *
 * The last two tests cover the set transport's loop when resolveTask() ends
 * a wait while the loop's SPOP for that task is in flight, and
 * startCompletionLoop(), which exits the engine with status 1 when a
 * connector's loop stops on an unexpected error.
 *
 * Self-contained: uses a fake redis client, no live services.
 * Run with:  node tests/connector.js
 */
const assert = require('assert');
const util = require('util');
const RemoteJobConnector = require('../wflib/connector.js');
const StreamRemoteJobConnector = RemoteJobConnector.StreamRemoteJobConnector;
const startCompletionLoop = RemoteJobConnector.startCompletionLoop;

class FakeRedis {
    constructor() {
        // legacy set-transport state
        this.sets = {};
        this.calls = { srandmember: 0, xreadgroup: 0, xgroup: 0 };
        this.onSpop = null; // test hook: called with the key inside spop, before its callback

        // stream-transport state: key -> { entries: [{id, fields}], groups: {...} }
        this.streams = {};
        this.failNextXack = false; // test hook: simulate a crash between delivery and ack
    }

    // ---- legacy set commands (unchanged) ----

    _set(key) {
        if (!this.sets[key]) this.sets[key] = new Set();
        return this.sets[key];
    }
    sadd(key, member, cb) {
        this._set(key).add(String(member));
        if (cb) setImmediate(cb, null, 1);
    }
    srandmember(key, cb) {
        this.calls.srandmember++;
        const s = this.sets[key];
        const v = (s && s.size) ? s.values().next().value : null;
        setImmediate(cb, null, v);
    }
    spop(key, cb) {
        const s = this.sets[key];
        let v = null;
        if (s && s.size) {
            v = s.values().next().value;
            s.delete(v);
        }
        if (this.onSpop) this.onSpop(key);
        setImmediate(cb, null, v);
    }
    srem(key, member, cb) {
        const s = this.sets[key];
        const n = (s && s.delete(String(member))) ? 1 : 0;
        setImmediate(cb, null, n);
    }

    // ---- stream-transport commands ----
    // Reply shapes match the redis:5.0.7 / node_redis@3.1 probe findings in
    // docs/completion-notification-redesign.md: XREADGROUP replies are raw
    // nested arrays [[key, [[id, [f1,v1,...]], ...]]], or bare `null` on an
    // empty BLOCKing read; XGROUP CREATE on an existing group rejects with
    // an Error whose .code === 'BUSYGROUP'.

    _stream(key) {
        if (!this.streams[key]) {
            this.streams[key] = { entries: [], nextMs: 0, nextSeq: -1, groups: {} };
        }
        return this.streams[key];
    }

    _nextId(stream) {
        const now = Date.now();
        if (now === stream.nextMs) {
            stream.nextSeq++;
        } else {
            stream.nextMs = now;
            stream.nextSeq = 0;
        }
        return stream.nextMs + "-" + stream.nextSeq;
    }

    // xadd(key, ['MAXLEN','~','100000',] '*', field1, val1, field2, val2, ..., cb)
    xadd(...args) {
        const cb = args.pop();
        const key = args[0];
        const starIdx = args.indexOf('*');
        const fieldsFlat = starIdx >= 0 ? args.slice(starIdx + 1) : args.slice(1);
        const stream = this._stream(key);
        const id = this._nextId(stream);
        stream.entries.push({ id, fields: fieldsFlat });
        // wake any '>' readers blocked on this key
        for (const groupName in stream.groups) {
            const group = stream.groups[groupName];
            if (group.waiters.length) {
                const waiters = group.waiters;
                group.waiters = [];
                waiters.forEach((w) => w());
            }
        }
        setImmediate(cb, null, id);
    }

    // xgroup([ 'CREATE', key, group, startId, 'MKSTREAM' ], cb)
    xgroup(args, cb) {
        this.calls.xgroup++;
        const [, key, group] = args;
        const stream = this._stream(key);
        if (stream.groups[group]) {
            const err = new Error('BUSYGROUP Consumer Group name already exists');
            err.code = 'BUSYGROUP';
            setImmediate(cb, err);
            return;
        }
        stream.groups[group] = { lastDeliveredIndex: -1, pel: new Map(), waiters: [] };
        setImmediate(cb, null, 'OK');
    }

    // xreadgroup(['GROUP', group, consumer, 'COUNT', n, ('BLOCK', ms)?, 'STREAMS', key, id], cb)
    xreadgroup(args, cb) {
        this.calls.xreadgroup++;
        const groupIdx = args.indexOf('GROUP');
        const group = args[groupIdx + 1];
        const countIdx = args.indexOf('COUNT');
        const count = countIdx >= 0 ? Number(args[countIdx + 1]) : Infinity;
        const blockIdx = args.indexOf('BLOCK');
        const blockMs = blockIdx >= 0 ? Number(args[blockIdx + 1]) : null;
        const streamsIdx = args.indexOf('STREAMS');
        const key = args[streamsIdx + 1];
        const id = args[streamsIdx + 2];

        const stream = this._stream(key);
        const g = stream.groups[group];
        if (!g) {
            setImmediate(cb, null, null);
            return;
        }

        const respond = () => {
            if (id === '0') {
                // PEL replay: everything currently pending for this group, in stream order.
                const pelIds = new Set(g.pel.keys());
                const entries = stream.entries
                    .filter((e) => pelIds.has(e.id))
                    .map((e) => [e.id, e.fields]);
                setImmediate(cb, null, [[key, entries]]);
                return;
            }

            // '>' new entries
            const available = stream.entries.slice(g.lastDeliveredIndex + 1);
            if (available.length > 0) {
                const batch = available.slice(0, count);
                batch.forEach((e) => g.pel.set(e.id, e.fields));
                g.lastDeliveredIndex += batch.length;
                this.calls.xreadgroupDeliveredByKey = this.calls.xreadgroupDeliveredByKey || {};
                this.calls.xreadgroupDeliveredByKey[key] = (this.calls.xreadgroupDeliveredByKey[key] || 0) + 1;
                setImmediate(cb, null, [[key, batch.map((e) => [e.id, e.fields])]]);
            } else if (blockMs !== null) {
                let done = false;
                const waiter = () => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    const idx = g.waiters.indexOf(waiter);
                    if (idx >= 0) g.waiters.splice(idx, 1);
                    respond();
                };
                const timer = setTimeout(() => {
                    if (done) return;
                    done = true;
                    const idx = g.waiters.indexOf(waiter);
                    if (idx >= 0) g.waiters.splice(idx, 1);
                    cb(null, null);
                }, blockMs);
                g.waiters.push(waiter);
            } else {
                setImmediate(cb, null, null);
            }
        };
        respond();
    }

    // xack([key, group, id1, id2, ...], cb)
    xack(args, cb) {
        if (this.failNextXack) {
            this.failNextXack = false;
            setImmediate(cb, new Error('simulated XACK failure'));
            return;
        }
        const [key, group, ...ids] = args;
        const stream = this._stream(key);
        const g = stream.groups[group];
        let n = 0;
        if (g) {
            ids.forEach((id) => { if (g.pel.delete(id)) n++; });
        }
        setImmediate(cb, null, n);
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, timeoutMs, intervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await sleep(intervalMs);
    }
    return predicate();
}

function withTimeout(promise, ms, what) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timed out after " + ms + " ms: " + what)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runLegacyTests() {
    const rcl = new FakeRedis();
    const wfId = "1";
    const interval = 20;
    const pendingKey = "wf:" + wfId + ":tasksPendingCompletionHandling";
    const connector = new RemoteJobConnector(rcl, wfId, interval);
    connector.run();

    // 1. Normal completion: observer registered, then notification arrives.
    const t1 = "hfid:1:5:1";
    const p1 = connector.waitForTask(t1);
    rcl.sadd(t1, "0");
    rcl.sadd(pendingKey, t1);
    const r1 = await p1;
    assert.deepStrictEqual(r1, [null, "0"], "expected exit code 0, got " + JSON.stringify(r1));
    assert.strictEqual(rcl._set(pendingKey).size, 0, "notification not removed after handling");
    console.log("ok 1 - normal completion resolves and clears the notification");

    // 2. Duplicate notification for an already handled task must be removed
    //    (used to stay in the set forever).
    rcl.sadd(pendingKey, t1);
    await sleep(interval * 5);
    assert.strictEqual(rcl._set(pendingKey).size, 0, "duplicate notification not removed");
    console.log("ok 2 - duplicate notification for a handled task is removed");

    // 3. Notification arriving before waitForTask() must keep the result
    //    intact until the observer registers (used to SPOP and drop it).
    const t2 = "hfid:1:6:1";
    rcl.sadd(t2, "0");
    rcl.sadd(pendingKey, t2);
    await sleep(interval * 3); // poller draws it several times with no observer
    const r2 = await connector.waitForTask(t2);
    assert.deepStrictEqual(r2, [null, "0"], "early notification lost its result: " + JSON.stringify(r2));
    console.log("ok 3 - early notification survives until the observer registers");

    // 4. An unobserved notification must not make the poll loop busy-poll
    //    (used to skip the checkInterval sleep entirely).
    const t3 = "hfid:1:7:1";
    rcl.sadd(pendingKey, t3);
    const before = rcl.calls.srandmember;
    const spinMs = interval * 10;
    await sleep(spinMs);
    const iterations = rcl.calls.srandmember - before;
    const budget = (spinMs / interval) * 3; // generous: ~10 expected, was 1000s before the fix
    assert.ok(iterations <= budget,
        "poll loop busy-polls: " + iterations + " iterations in " + spinMs + "ms (budget " + budget + ")");
    console.log("ok 4 - unobserved notification does not busy-poll (" + iterations + " iterations in " + spinMs + "ms)");

    await connector.stop();
    await sleep(interval * 2);
    console.log("all legacy connector tests passed");
}

async function runStreamTests() {
    // 5. Normal completion over the stream transport.
    {
        const rcl = new FakeRedis();
        const hfId = "streamhf1";
        const connector = new StreamRemoteJobConnector(rcl, hfId);
        connector.run();

        const t1 = hfId + ":1:5:1";
        const p1 = connector.waitForTask(t1);
        rcl.xadd(connector.streamKey, 'MAXLEN', '~', '100000', '*', 'taskId', t1, 'code', '0', () => {});
        const r1 = await p1;
        assert.deepStrictEqual(r1, [null, "0"], "expected exit code 0, got " + JSON.stringify(r1));
        console.log("ok 5 - stream: normal completion resolves");

        await connector.stop();
    }

    // 6. Duplicate notification for an already-handled task is dropped (no
    //    crash, no re-resolve) and still gets XACK'd off the PEL.
    {
        const rcl = new FakeRedis();
        const hfId = "streamhf2";
        const connector = new StreamRemoteJobConnector(rcl, hfId);
        connector.run();

        const t1 = hfId + ":1:5:1";
        const p1 = connector.waitForTask(t1);
        rcl.xadd(connector.streamKey, '*', 'taskId', t1, 'code', '0', () => {});
        await p1;

        // Duplicate (e.g. executor retry) for the same task.
        rcl.xadd(connector.streamKey, '*', 'taskId', t1, 'code', '1', () => {});
        const drained = await waitUntil(
            () => rcl.streams[connector.streamKey].groups[connector.group].pel.size === 0,
            2000, 10);
        assert.ok(drained, "duplicate notification was not drained from the PEL");
        assert.strictEqual(connector.handledTasks.has(t1), true, "task should remain in handledTasks");

        // Sanity: connector loop is still healthy after the duplicate.
        const t2 = hfId + ":1:6:1";
        const p2 = connector.waitForTask(t2);
        rcl.xadd(connector.streamKey, '*', 'taskId', t2, 'code', '0', () => {});
        const r2 = await p2;
        assert.deepStrictEqual(r2, [null, "0"]);
        console.log("ok 6 - stream: duplicate notification is dropped, loop stays healthy");

        await connector.stop();
    }

    // 7. Early arrival: event lands before waitForTask() registers; resolved
    //    immediately (from the in-memory earlyEvents map) once it does.
    {
        const rcl = new FakeRedis();
        const hfId = "streamhf3";
        const connector = new StreamRemoteJobConnector(rcl, hfId);
        connector.run();

        const t1 = hfId + ":1:5:1";
        rcl.xadd(connector.streamKey, '*', 'taskId', t1, 'code', '0', () => {});
        const stashed = await waitUntil(() => connector.earlyEvents[t1] !== undefined, 2000, 10);
        assert.ok(stashed, "early event was never stashed");

        const r1 = await connector.waitForTask(t1);
        assert.deepStrictEqual(r1, [null, "0"], "early notification lost its result: " + JSON.stringify(r1));
        console.log("ok 7 - stream: early arrival survives until the observer registers");

        await connector.stop();
    }

    // 8. Burst of 200 simultaneous completions, drained with COUNT 128 in
    //    exactly 2 non-empty reads.
    {
        const rcl = new FakeRedis();
        const hfId = "streamhf4";
        const connector = new StreamRemoteJobConnector(rcl, hfId);
        const N = 200;
        const taskIds = [];
        const promises = [];
        for (let i = 0; i < N; i++) {
            const taskId = hfId + ":1:" + i + ":1";
            taskIds.push(taskId);
            promises.push(connector.waitForTask(taskId));
        }
        // Fire all N notifications "simultaneously" before starting the loop.
        taskIds.forEach((taskId) => {
            rcl.xadd(connector.streamKey, '*', 'taskId', taskId, 'code', '0', () => {});
        });

        connector.run();
        const results = await Promise.all(promises);
        results.forEach((r, i) => assert.deepStrictEqual(r, [null, "0"], "task " + i + " got " + JSON.stringify(r)));

        const delivered = (rcl.calls.xreadgroupDeliveredByKey || {})[connector.streamKey] || 0;
        assert.strictEqual(delivered, 2,
            "expected COUNT 128 to drain 200 entries in exactly 2 reads, got " + delivered);
        console.log("ok 8 - stream: burst of " + N + " drained in " + delivered + " reads (COUNT 128)");

        await connector.stop();
    }

    // 9. Multi-workflow demux: one process-wide connector, two different
    //    wfIds sharing the same hfId stream, both observers resolve.
    {
        const rcl = new FakeRedis();
        const hfId = "streamhf5";
        const connector = new StreamRemoteJobConnector(rcl, hfId);
        connector.run();

        const tA = hfId + ":1:5:1"; // wfId "1"
        const tB = hfId + ":2:9:1"; // wfId "2"
        const pA = connector.waitForTask(tA);
        const pB = connector.waitForTask(tB);
        rcl.xadd(connector.streamKey, '*', 'taskId', tA, 'code', '0', () => {});
        rcl.xadd(connector.streamKey, '*', 'taskId', tB, 'code', '1', () => {});

        const [rA, rB] = await Promise.all([pA, pB]);
        assert.deepStrictEqual(rA, [null, "0"]);
        assert.deepStrictEqual(rB, [null, "1"]);
        console.log("ok 9 - stream: two workflows demuxed through one process-wide connector");

        await connector.stop();
    }

    // 10. PEL redelivery: an entry delivered but not XACK'd (simulated crash)
    //     is redelivered to a fresh connector instance on the same stream.
    {
        const rcl = new FakeRedis();
        const hfId = "streamhf6";
        const connectorA = new StreamRemoteJobConnector(rcl, hfId);
        connectorA.run();

        const t1 = hfId + ":1:5:1";
        rcl.failNextXack = true; // simulate a crash between delivery and ack
        rcl.xadd(connectorA.streamKey, '*', 'taskId', t1, 'code', '0', () => {});

        // Entry was delivered (advances the group cursor) but stays in the
        // server-side PEL because the ack failed.
        const stuck = await waitUntil(
            () => rcl.streams[connectorA.streamKey] &&
                  rcl.streams[connectorA.streamKey].groups[connectorA.group] &&
                  rcl.streams[connectorA.streamKey].groups[connectorA.group].pel.size === 1,
            2000, 10);
        assert.ok(stuck, "entry was not left pending in the PEL after the simulated ack failure");
        await connectorA.stop();

        // Simulate an engine restart: brand new connector instance (no
        // shared in-memory state), same hfId/stream/group. Its startup PEL
        // drain must redeliver the stuck entry.
        const connectorB = new StreamRemoteJobConnector(rcl, hfId);
        connectorB.run();

        const redelivered = await waitUntil(() => connectorB.earlyEvents[t1] !== undefined, 2000, 10);
        assert.ok(redelivered, "PEL entry was not redelivered to the fresh connector instance");

        const r1 = await connectorB.waitForTask(t1);
        assert.deepStrictEqual(r1, [null, "0"], "redelivered result mismatch: " + JSON.stringify(r1));

        const acked = await waitUntil(
            () => rcl.streams[connectorB.streamKey].groups[connectorB.group].pel.size === 0,
            2000, 10);
        assert.ok(acked, "redelivered entry was not acked by the fresh connector");
        console.log("ok 10 - stream: PEL redelivery to a fresh connector instance after a simulated crash");

        await connectorB.stop();
    }

    console.log("all stream connector tests passed");
}

// 11. resolveTask() ends a wait while the set transport's loop has SPOP in
//     flight for that task (the fake redis calls it from inside spop). The
//     loop must discard the result instead of calling the gone observer,
//     still remove the notification, and keep delivering completions.
async function runResolveDuringSpopTest() {
    const rcl = new FakeRedis();
    const wfId = "2";
    const interval = 20;
    const pendingKey = "wf:" + wfId + ":tasksPendingCompletionHandling";
    const connector = new RemoteJobConnector(rcl, wfId, interval);

    const t1 = "hfid:2:5:1";
    const p1 = connector.waitForTask(t1);
    const observer = connector.jobPromiseResolves[t1];
    let observerCalls = 0;
    connector.jobPromiseResolves[t1] = (result) => { observerCalls++; observer(result); };
    rcl.onSpop = (key) => {
        if (key === t1) connector.resolveTask(t1, 1);
    };
    rcl.sadd(t1, "0");
    rcl.sadd(pendingKey, t1);
    // Count how often the loop draws t1: once, if the discard path removes
    // the notification itself.
    let t1Draws = 0;
    const srandmember = rcl.srandmember.bind(rcl);
    rcl.srandmember = (key, cb) => srandmember(key, (err, v) => {
        if (v === t1) t1Draws++;
        cb(err, v);
    });

    let runError = null;
    const loop = connector.run().catch((err) => { runError = err; });

    const r1 = await withTimeout(p1, 2000, "wait for " + t1);
    assert.deepStrictEqual(r1, [null, "1"], "expected the resolveTask code, got " + JSON.stringify(r1));
    const removed = await waitUntil(() => !rcl._set(pendingKey).has(t1), 2000, 5);
    await sleep(interval * 3); // let the loop go past the completion it drew
    assert.strictEqual(runError, null, "run() rejected: " + (runError && runError.stack));
    assert.ok(removed, "notification not removed from the pending set");
    assert.strictEqual(t1Draws, 1, "the loop drew " + t1 + " " + t1Draws + " times, expected once");
    assert.strictEqual(observerCalls, 1, "observer called " + observerCalls + " times, expected once");

    rcl.onSpop = null;
    const t2 = "hfid:2:6:1";
    const p2 = connector.waitForTask(t2);
    rcl.sadd(t2, "0");
    rcl.sadd(pendingKey, t2);
    const r2 = await withTimeout(p2, 2000, "wait for " + t2 + " after the discarded completion");
    assert.deepStrictEqual(r2, [null, "0"], "expected exit code 0, got " + JSON.stringify(r2));
    assert.strictEqual(runError, null, "run() rejected: " + (runError && runError.stack));
    console.log("ok 11 - resolveTask during SPOP: result discarded, notification removed, loop keeps running");

    await connector.stop();
    await loop;
}

// 12. startCompletionLoop(): a loop that rejects is logged with the
//     connector's name and exits the engine with status 1, for both
//     connectors; a loop ended by stop() does not exit.
async function runCompletionLoopExitTest() {
    const saved = { exit: process.exit, error: console.error };
    const logs = [];
    const exitCodes = [];
    console.error = (...args) => logs.push(util.format(...args));
    process.exit = (code) => { exitCodes.push(code); };
    try {
        const failing = [
            new RemoteJobConnector(new FakeRedis(), "3", 20),
            new StreamRemoteJobConnector(new FakeRedis(), "streamhf7"),
        ];
        for (const connector of failing) {
            const name = connector.constructor.name;
            const failure = new Error("simulated failure in " + name);
            connector.run = async () => { throw failure; };
            logs.length = 0;
            exitCodes.length = 0;
            await startCompletionLoop(connector);
            assert.deepStrictEqual(exitCodes, [1], name + ": expected process.exit(1), got " + JSON.stringify(exitCodes));
            const logged = logs.some((l) => l.startsWith("[" + name + "]") &&
                /completion loop stopped/i.test(l) && l.includes(failure.message));
            assert.ok(logged,
                name + ": no log line naming the connector, the stop and the error: " + JSON.stringify(logs));
        }

        const stopped = new RemoteJobConnector(new FakeRedis(), "4", 20);
        exitCodes.length = 0;
        const loop = startCompletionLoop(stopped);
        await stopped.stop();
        await withTimeout(loop, 2000, "stopped loop to end");
        assert.deepStrictEqual(exitCodes, [], "a stopped loop called process.exit: " + JSON.stringify(exitCodes));
    } finally {
        console.error = saved.error;
        process.exit = saved.exit;
    }
    console.log("ok 12 - a completion loop that rejects is logged and exits the engine with status 1");
}

async function main() {
    await runLegacyTests();
    await runStreamTests();
    await runResolveDuringSpopTest();
    await runCompletionLoopExitTest();
    console.log("all connector tests passed");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

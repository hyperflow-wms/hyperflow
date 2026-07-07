/**
 * Regression tests for wflib/connector.js (RemoteJobConnector poll loop).
 *
 * Covers three defects fixed in the observer-not-found path:
 *  1. a completion notification for an unobserved task was never SREM'd from
 *     the notification set (stayed there forever);
 *  2. drawing such a notification skipped the checkInterval sleep, so the
 *     poll loop busy-polled redis at maximum rate;
 *  3. the task result was SPOP'd *before* the observer check, so a
 *     notification arriving just before waitForTask() registered destroyed
 *     the exit code.
 *
 * Self-contained: uses a fake redis client, no live services.
 * Run with:  node tests/connector.js
 */
const assert = require('assert');
const RemoteJobConnector = require('../wflib/connector.js');

class FakeRedis {
    constructor() {
        this.sets = {};
        this.calls = { srandmember: 0 };
    }
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
        setImmediate(cb, null, v);
    }
    srem(key, member, cb) {
        const s = this.sets[key];
        const n = (s && s.delete(String(member))) ? 1 : 0;
        setImmediate(cb, null, n);
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
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
    console.log("all connector tests passed");
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

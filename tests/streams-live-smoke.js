/**
 * Manual live smoke test for StreamRemoteJobConnector against a *real*
 * Redis 5.0.7 server (docker container "redis-probe" on localhost:6379).
 *
 * Not part of the self-contained FakeRedis suite in tests/connector.js -
 * this one needs a live service and is run separately:
 *
 *   node tests/streams-live-smoke.js
 *
 * Covers:
 *  1. normal completion - waitForTask() registers first, a raw XADD
 *     (shaped exactly like the executor's notifyJobCompletion: MAXLEN ~
 *     100000, fields taskId/code) arrives after, promise resolves
 *     [null, code] well under the connector's BLOCK=5000 window.
 *  2. early arrival - the raw XADD lands *before* waitForTask() is called
 *     for that taskId; the connector's background XREADGROUP loop stashes
 *     it in earlyEvents, and waitForTask() resolves it immediately once
 *     called.
 *
 * Exits 0 on success, non-zero (with the failing assertion/error printed)
 * on any failure.
 */
const assert = require('assert');
const redis = require('redis');
const StreamRemoteJobConnector = require('../wflib/connector.js').StreamRemoteJobConnector;

const REDIS_HOST = 'localhost';
const REDIS_PORT = 6379;

// Fixed, deterministic per-run id (no Date.now()/Math.random()) so the
// stream key/group are stable and easy to inspect by hand if this fails.
const hfId = 'smoke-streams-live';
const streamKey = 'hf:' + hfId + ':completions';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, timeoutMs, intervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await sleep(intervalMs);
    }
    return predicate();
}

// Raw XADD shaped exactly like the executor's notifyJobCompletion() for the
// "stream" transport: XADD hf:<hfId>:completions MAXLEN ~ 100000 * taskId
// <taskId> code <code>.
function rawXadd(rcl, taskId, code) {
    return new Promise((resolve, reject) => {
        rcl.xadd(streamKey, 'MAXLEN', '~', '100000', '*', 'taskId', taskId, 'code', code,
            (err, id) => err ? reject(err) : resolve(id));
    });
}

function delKey(rcl, key) {
    return new Promise((resolve, reject) => {
        rcl.del(key, (err, reply) => err ? reject(err) : resolve(reply));
    });
}

async function main() {
    const rcl = redis.createClient({ host: REDIS_HOST, port: REDIS_PORT });
    const blockingClient = rcl.duplicate();

    await new Promise((resolve, reject) => {
        let pending = 2;
        const onReady = () => { if (--pending === 0) resolve(); };
        rcl.on('error', reject);
        blockingClient.on('error', reject);
        rcl.on('ready', onReady);
        blockingClient.on('ready', onReady);
    });
    console.log('[smoke] connected to redis at', REDIS_HOST + ':' + REDIS_PORT);

    // Start from a clean stream (also drops any leftover consumer group /
    // PEL from a previous run of this same smoke test).
    await delKey(rcl, streamKey);
    console.log('[smoke] cleared', streamKey);

    const connector = new StreamRemoteJobConnector(blockingClient, hfId);
    const runPromise = connector.run();

    let failed = false;
    try {
        // 1. Normal completion: observer registered first, then the event
        //    arrives. Must resolve well under BLOCK=5000ms.
        const taskId1 = hfId + ':1:5:1';
        const t0 = Date.now();
        const p1 = connector.waitForTask(taskId1);
        await rawXadd(rcl, taskId1, '0');
        const r1 = await p1;
        const elapsed1 = Date.now() - t0;
        assert.deepStrictEqual(r1, [null, '0'], 'expected [null,"0"], got ' + JSON.stringify(r1));
        assert.ok(elapsed1 < 4000,
            'normal completion took ' + elapsed1 + 'ms, expected well under BLOCK=5000ms');
        console.log('ok 1 - normal completion round-tripped through live redis in ' + elapsed1 + 'ms');

        // 2. Early arrival: raw XADD happens BEFORE waitForTask() is called
        //    for that taskId. Wait until the background loop has actually
        //    stashed it (so this genuinely exercises the early-arrival path,
        //    not a lucky race), then call waitForTask() and expect an
        //    immediate resolve.
        const taskId2 = hfId + ':1:6:1';
        await rawXadd(rcl, taskId2, '0');
        const stashed = await waitUntil(() => connector.earlyEvents[taskId2] !== undefined, 4000, 20);
        assert.ok(stashed, 'early event for ' + taskId2 + ' was never stashed by the connector loop');

        const t1 = Date.now();
        const r2 = await connector.waitForTask(taskId2);
        const elapsed2 = Date.now() - t1;
        assert.deepStrictEqual(r2, [null, '0'], 'expected [null,"0"], got ' + JSON.stringify(r2));
        assert.ok(elapsed2 < 4000,
            'early-arrival resolve took ' + elapsed2 + 'ms, expected well under BLOCK=5000ms');
        console.log('ok 2 - early arrival stashed then resolved immediately (' + elapsed2 + 'ms after waitForTask)');

        console.log('all live smoke tests passed');
    } catch (error) {
        failed = true;
        console.error('[smoke] FAILED:', error);
    }

    // Cleanup: stop the connector, wait for its blocking loop to actually
    // return (it regains control on its next BLOCK=5000 cycle at the
    // latest), then quit both clients and drop the stream key.
    await connector.stop();
    await Promise.race([runPromise, sleep(6000)]);

    try {
        await delKey(rcl, streamKey);
    } catch (error) {
        console.error('[smoke] cleanup: failed to delete', streamKey, error);
    }

    await new Promise((resolve) => rcl.quit(resolve));
    await new Promise((resolve) => blockingClient.quit(resolve));

    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error('[smoke] unhandled error:', err);
    process.exit(1);
});

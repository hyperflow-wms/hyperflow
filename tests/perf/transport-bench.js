#!/usr/bin/env node
/**
 * Layer 1.5 performance benchmark harness for the task-completion notification
 * transport(s). See docs/completion-notification-redesign.md, section
 * "Layer 1.5 — transport performance benchmark".
 *
 * IMPORTANT: this drives the REAL, unmodified connector classes from both
 * repos -- never a reimplementation:
 *   - consumer: /home/balis/hyperflow/wflib/connector.js
 *       (RemoteJobConnector today; StreamRemoteJobConnector once it exists)
 *   - producer: /home/balis/hyperflow-job-executor/connector.js
 *
 * It targets the dockerized redis-probe (redis:5.0.7-buster, localhost:6379)
 * and may FLUSHALL it between cells. Never run against a shared/real Redis.
 *
 * CLI:
 *   node tests/perf/transport-bench.js --transport <set|stream> \
 *       --regime <1|2|3|4> [--samples N] [--check-interval MS] \
 *       [--stale K] [--n N]
 *
 * Regimes (see design doc for full rationale):
 *   1. idle -> first-event latency (poll-floor cost)
 *   2. burst drain of N simultaneous completions
 *   3. dilution: K foreign-hfId orphans preloaded, time-to-resolve one live task
 *   4. idle overhead over 60s (INFO commandstats delta + connection count)
 *
 * Today (2026-07-09) only --transport set produces valid numbers: the
 * Streams implementation (StreamRemoteJobConnector / executor "transport"
 * property) has not landed yet. This harness already implements the full
 * contract so the identical CLI re-runs unchanged for the "after" numbers.
 */
'use strict';

const path = require('path');
const redis = require('redis');
const minimist = require('minimist');

// ---------------------------------------------------------------------------
// Fixed paths to the REAL connector modules (per design doc export contract).
// ---------------------------------------------------------------------------
const ENGINE_CONNECTOR_PATH = path.join(__dirname, '..', '..', 'wflib', 'connector.js');
const EXECUTOR_CONNECTOR_PATH = '/home/balis/hyperflow-job-executor/connector.js';

const RemoteJobConnector = require(ENGINE_CONNECTOR_PATH);
const StreamRemoteJobConnector = require(ENGINE_CONNECTOR_PATH).StreamRemoteJobConnector; // undefined until implemented
const ExecutorConnector = require(EXECUTOR_CONNECTOR_PATH);

const REDIS_HOST = process.env.HF_BENCH_REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.HF_BENCH_REDIS_PORT || 6379);

// Only used to shorten regime 4's idle window during manual smoke-testing of
// this harness itself; the official contract's 60s window is untouched
// unless this env var is set.
const REGIME4_DURATION_MS = Number(process.env.HF_BENCH_REGIME4_DURATION_MS || 60000);

const USAGE = `Usage: node tests/perf/transport-bench.js --transport <set|stream> --regime <1|2|3|4> [--samples N] [--check-interval MS] [--stale K] [--n N]`;

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
    return Number(process.hrtime.bigint()) / 1e6;
}

function call(client, cmd, ...args) {
    return new Promise((resolve, reject) => {
        client[cmd](...args, (err, reply) => (err ? reject(err) : resolve(reply)));
    });
}

function connect() {
    return new Promise((resolve, reject) => {
        const client = redis.createClient({ host: REDIS_HOST, port: REDIS_PORT });
        const onError = (e) => reject(e);
        client.once('error', onError);
        client.once('ready', () => {
            client.removeListener('error', onError);
            client.on('error', (e) => console.error('[redis client error]', e.message));
            resolve(client);
        });
    });
}

function computeStats(samplesMs) {
    if (samplesMs.length === 0) return null;
    const s = [...samplesMs].sort((a, b) => a - b);
    const pct = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
    const sum = s.reduce((a, b) => a + b, 0);
    return {
        n: s.length,
        min: Number(s[0].toFixed(2)),
        p50: Number(pct(50).toFixed(2)),
        p95: Number(pct(95).toFixed(2)),
        max: Number(s[s.length - 1].toFixed(2)),
        mean: Number((sum / s.length).toFixed(2)),
    };
}

function parseInfoField(info, field) {
    const m = info.match(new RegExp('^' + field + ':(.+)$', 'm'));
    return m ? m[1].trim().replace(/\r$/, '') : null;
}

function parseCommandStats(info) {
    const stats = {};
    const re = /^cmdstat_([a-zA-Z_|]+):calls=(\d+),usec=(\d+)/gm;
    let m;
    while ((m = re.exec(info))) {
        stats[m[1]] = { calls: Number(m[2]), usec: Number(m[3]) };
    }
    return stats;
}

async function snapshotServerStats(client) {
    const infoAll = await call(client, 'info', 'all');
    return {
        connectedClients: parseInfoField(infoAll, 'connected_clients'),
        commandstats: parseCommandStats(infoAll),
    };
}

function diffCommandStats(before, after) {
    const cmds = new Set([...Object.keys(before), ...Object.keys(after)]);
    const out = {};
    for (const c of cmds) {
        const b = before[c] || { calls: 0, usec: 0 };
        const a = after[c] || { calls: 0, usec: 0 };
        const dcalls = a.calls - b.calls;
        if (dcalls !== 0) out[c] = { calls: dcalls, usec: a.usec - b.usec };
    }
    return out;
}

// ---------------------------------------------------------------------------
// transport plumbing
// ---------------------------------------------------------------------------

function assertTransportAvailable(transport) {
    if (transport !== 'set' && transport !== 'stream') {
        throw new Error(`unknown --transport '${transport}', expected 'set' or 'stream'`);
    }
    if (transport === 'stream') {
        if (typeof StreamRemoteJobConnector !== 'function') {
            throw new Error(
                "--transport stream requested, but wflib/connector.js does not (yet) export " +
                "StreamRemoteJobConnector -- product code not implemented. This harness already " +
                "implements the full CLI contract for after the Streams work lands; today only " +
                "`--transport set` produces valid baseline numbers."
            );
        }
        const probe = new ExecutorConnector(null, 'probe-wf');
        if (!Object.prototype.hasOwnProperty.call(probe, 'transport')) {
            throw new Error(
                "--transport stream requested, but hyperflow-job-executor/connector.js has no " +
                "'transport' property yet -- producer-side product code not implemented."
            );
        }
    }
}

async function setupClients(transport, opts = {}) {
    const rcl = await connect();
    const rclProducer = opts.skipProducer ? null : await connect();
    let blockingClient = null;
    if (transport === 'stream') {
        blockingClient = rcl.duplicate();
        await new Promise((resolve, reject) => {
            blockingClient.once('error', reject);
            blockingClient.once('ready', () => {
                blockingClient.removeAllListeners('error');
                resolve();
            });
        });
    }
    return { rcl, rclProducer, blockingClient };
}

async function closeClients({ rcl, rclProducer, blockingClient }) {
    const clients = [rcl, rclProducer, blockingClient].filter(Boolean);
    await Promise.all(clients.map((c) => new Promise((resolve) => c.quit(() => resolve()))));
}

function makeConsumer(transport, { rcl, blockingClient, wfId, hfId, checkInterval }) {
    if (transport === 'set') return new RemoteJobConnector(rcl, wfId, checkInterval);
    if (transport === 'stream') return new StreamRemoteJobConnector(blockingClient, hfId);
    throw new Error('unknown transport ' + transport);
}

function makeProducer(transport, { rclProducer, wfId }) {
    const conn = new ExecutorConnector(rclProducer, wfId);
    if (transport === 'stream') conn.transport = 'stream';
    return conn;
}

// ---------------------------------------------------------------------------
// regimes
// ---------------------------------------------------------------------------

// Regime 1: idle -> first-event latency.
async function regime1({ transport, checkInterval, samples }) {
    assertTransportAvailable(transport);
    const { rcl, rclProducer, blockingClient } = await setupClients(transport);
    await call(rcl, 'flushall');

    const hfId = 'benchHf1';
    const wfId = 'benchWf1';
    const consumer = makeConsumer(transport, { rcl, blockingClient, wfId, hfId, checkInterval });
    const producer = makeProducer(transport, { rclProducer, wfId });
    consumer.run().catch((err) => console.error('[consumer.run] crashed:', err));

    const latencies = [];
    for (let i = 0; i < samples; i++) {
        const taskId = `${hfId}:${wfId}:0:${i}`;
        const p = consumer.waitForTask(taskId, 'benchTask');
        // "notifies once at a random moment while the consumer idles": without
        // this jitter, back-to-back samples resolve-then-immediately-re-notify
        // in lockstep with the poll loop's own immediate post-success re-poll,
        // which resonates with checkInterval instead of sampling it uniformly.
        // Sleeping a random offset before notifying (and starting the clock
        // only afterwards) decorrelates our sampling from the poll phase, as
        // an unpredictable task-completion moment would in production.
        await sleep(Math.random() * checkInterval);
        const t0 = nowMs();
        await producer.notifyJobCompletion(taskId, 0);
        const result = await p;
        const t1 = nowMs();
        if (!result || String(result[1]) !== '0') {
            console.error(`[regime1] WARNING unexpected result for ${taskId}:`, result);
        }
        latencies.push(t1 - t0);
        if ((i + 1) % 20 === 0) console.error(`[regime1] ${i + 1}/${samples} samples...`);
    }

    await consumer.stop();
    await sleep(50);
    await closeClients({ rcl, rclProducer, blockingClient });

    return { regime: 1, transport, checkInterval, samples: latencies.length, stats: computeStats(latencies) };
}

// Regime 2: burst drain of N simultaneous completions.
async function regime2({ transport, checkInterval, n, samples }) {
    assertTransportAvailable(transport);
    const { rcl, rclProducer, blockingClient } = await setupClients(transport);
    await call(rcl, 'flushall');

    const hfId = 'benchHf2';
    const wfId = 'benchWf2';
    const consumer = makeConsumer(transport, { rcl, blockingClient, wfId, hfId, checkInterval });
    const producer = makeProducer(transport, { rclProducer, wfId });
    consumer.run().catch((err) => console.error('[consumer.run] crashed:', err));

    const drainTimes = [];
    for (let trial = 0; trial < samples; trial++) {
        const taskIds = [];
        for (let i = 0; i < n; i++) taskIds.push(`${hfId}:${wfId}:0:${trial}_${i}`);
        const promises = taskIds.map((id) => consumer.waitForTask(id, 'benchTask'));
        const t0 = nowMs();
        await Promise.all(taskIds.map((id) => producer.notifyJobCompletion(id, 0)));
        await Promise.all(promises);
        const t1 = nowMs();
        drainTimes.push(t1 - t0);
        console.error(`[regime2] trial ${trial + 1}/${samples}: drained ${n} in ${(t1 - t0).toFixed(1)}ms`);
    }

    await consumer.stop();
    await sleep(50);
    await closeClients({ rcl, rclProducer, blockingClient });

    return { regime: 2, transport, checkInterval, n, samples: drainTimes.length, stats: computeStats(drainTimes) };
}

// Regime 3: dilution -- K foreign-hfId orphans preloaded, time-to-resolve one live task.
async function regime3({ transport, checkInterval, stale, samples }) {
    assertTransportAvailable(transport);
    const { rcl, rclProducer, blockingClient } = await setupClients(transport);
    await call(rcl, 'flushall');

    const hfId = 'benchHf3';
    const wfId = 'benchWf3';

    if (transport === 'set') {
        // Legacy set key is scoped by wfId only (this *is* hyperflow#93):
        // orphans from dead hfIds land in the exact same
        // wf:<wfId>:tasksPendingCompletionHandling key as the live execution.
        const queueKey = `wf:${wfId}:tasksPendingCompletionHandling`;
        if (stale > 0) {
            const orphanIds = [];
            for (let i = 0; i < stale; i++) orphanIds.push(`orphanHf${i}:${wfId}:0:${i}`);
            await call(rcl, 'sadd', queueKey, ...orphanIds);
        }
    } else if (transport === 'stream') {
        // Streams are keyed by hfId, so K foreign-hfId orphans live in K
        // entirely different hf:<foreignHfId>:completions keys that the
        // process-wide consumer never reads. Nothing to preload; this
        // branch exists so the CLI contract is uniform across transports
        // and the "K-independence" claim can be exercised once implemented.
        console.error('[regime3] transport=stream: dilution preload is a no-op by design (orphans live in unrelated keys)');
    }

    const consumer = makeConsumer(transport, { rcl, blockingClient, wfId, hfId, checkInterval });
    const producer = makeProducer(transport, { rclProducer, wfId });
    consumer.run().catch((err) => console.error('[consumer.run] crashed:', err));

    const latencies = [];
    for (let i = 0; i < samples; i++) {
        const taskId = `${hfId}:${wfId}:0:live${i}`;
        const p = consumer.waitForTask(taskId, 'benchTask');
        const t0 = nowMs();
        await producer.notifyJobCompletion(taskId, 0);
        const result = await p;
        const t1 = nowMs();
        if (!result || String(result[1]) !== '0') {
            console.error(`[regime3] WARNING unexpected result for ${taskId}:`, result);
        }
        latencies.push(t1 - t0);
        console.error(`[regime3] K=${stale} sample ${i + 1}/${samples}: ${(t1 - t0).toFixed(1)}ms`);
    }

    await consumer.stop();
    await sleep(50);
    await closeClients({ rcl, rclProducer, blockingClient });

    return { regime: 3, transport, checkInterval, stale, samples: latencies.length, stats: computeStats(latencies) };
}

// Regime 4: idle overhead over 60s.
async function regime4({ transport, checkInterval }) {
    assertTransportAvailable(transport);
    const { rcl, blockingClient } = await setupClients(transport, { skipProducer: true });
    const adminClient = await connect();
    await call(rcl, 'flushall');

    const hfId = 'benchHf4';
    const wfId = 'benchWf4';
    const consumer = makeConsumer(transport, { rcl, blockingClient, wfId, hfId, checkInterval });
    consumer.run().catch((err) => console.error('[consumer.run] crashed:', err));

    await sleep(200); // let the consumer settle (initial poll / XGROUP CREATE etc.)

    const before = await snapshotServerStats(adminClient);
    console.error(
        `[regime4] measuring idle overhead for ${(REGIME4_DURATION_MS / 1000).toFixed(1)}s ` +
        `(transport=${transport}, checkInterval=${checkInterval})...`
    );
    await sleep(REGIME4_DURATION_MS);
    const after = await snapshotServerStats(adminClient);

    await consumer.stop();
    await sleep(50);
    await closeClients({ rcl, blockingClient });
    await call(adminClient, 'quit');

    const commandDelta = diffCommandStats(before.commandstats, after.commandstats);
    return {
        regime: 4,
        transport,
        checkInterval,
        durationMs: REGIME4_DURATION_MS,
        connectedClients: { before: before.connectedClients, after: after.connectedClients },
        commandDelta,
    };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
    const argv = minimist(process.argv.slice(2), { string: ['transport'] });

    const transport = argv.transport;
    const regime = argv.regime !== undefined ? String(argv.regime) : undefined;
    const checkInterval = argv['check-interval'] !== undefined ? Number(argv['check-interval']) : 3000;
    const samplesArg = argv.samples !== undefined ? Number(argv.samples) : undefined;
    const staleArg = argv.stale !== undefined ? Number(argv.stale) : 0;
    const nArg = argv.n !== undefined ? Number(argv.n) : 50;

    if (!transport || !regime) {
        console.error(USAGE);
        process.exit(2);
    }

    let result;
    const wallStart = Date.now();
    switch (regime) {
        case '1':
            result = await regime1({ transport, checkInterval, samples: samplesArg ?? 200 });
            break;
        case '2':
            result = await regime2({ transport, checkInterval, n: nArg, samples: samplesArg ?? 5 });
            break;
        case '3':
            result = await regime3({ transport, checkInterval, stale: staleArg, samples: samplesArg ?? 5 });
            break;
        case '4':
            result = await regime4({ transport, checkInterval });
            break;
        default:
            console.error('unknown --regime, expected 1|2|3|4');
            process.exit(2);
            return;
    }
    result.wallMs = Date.now() - wallStart;

    console.log('\n=== transport-bench result ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

main().catch((err) => {
    console.error('[transport-bench] FATAL:', err);
    process.exit(1);
});

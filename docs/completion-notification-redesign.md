# Design note: task-completion notification over Redis Streams

**Status: proposed (2026-07-08). Not implemented. Companion to
[hyperflow#93](https://github.com/hyperflow-wms/hyperflow/issues/93) (wfId
collision) and the executor-side connector defects found in the same
investigation. Spans three repos: `~/hyperflow` (consumer),
`~/hyperflow-job-executor` (producer), `~/wms_benchmark/simulation/vwr`
(producer, protocol replica).**

## Problem

Task completion is signaled through a *shared set + polling* protocol:

- **Producers** (three, byte-compatible):
  `hyperflow-job-executor/connector.js:31,37` (`SADD <taskId> <code>` then
  `SADD wf:<wfId>:tasksPendingCompletionHandling <taskId>`);
  `hyperflow-job-executor/packages/client-lib/redisConnector.js`
  (same pair, `work:<workId>:...` key); and the VWR
  (`wms_benchmark/simulation/vwr/src/redisConnector.js`), which replicates the
  executor pair byte-for-byte as a protocol-fidelity requirement.
- **Consumer**: `hyperflow/wflib/connector.js` (`RemoteJobConnector`) — every
  `checkInterval` (3000 ms, set at `wflib/index.js:215`) draws **one uniformly
  random member** (`SRANDMEMBER`) from the shared set, and if an in-memory
  observer exists, `SPOP`s the per-task result key and `SREM`s the
  notification.

Costs, all observed live during the 2026-07-08 Option C validation run
(small Montage2, ~620 tasks):

1. **Dilution / cross-execution pollution** ([hyperflow#93]): the set is keyed
   by `wfId`, a counter that deterministically restarts at 1 whenever Redis
   (a volume-less Deployment) is recreated. Orphaned notifications from a dead
   execution are never removed (no observer will ever claim them), so
   `SRANDMEMBER` draws are diluted for the live execution. Observed: 90 stale
   vs 1–2 live entries → **expected ~4.5 min to notice one completed task**
   (91 entries × 3 s per draw), on a task whose pod had finished in seconds.
   Manual `SREM` of the stale entries restored sub-second delivery instantly.
2. **Baseline latency**: polling means up to 3 s dead time per completion even
   in the healthy case. For DAG stages made of many short tasks, this is a
   floor on critical-path latency that no amount of worker scaling removes.
3. **One task per poll iteration**: `SRANDMEMBER`/`SPOP`/`SREM` are
   single-target and sequential. A burst of N simultaneous completions (10
   pool workers finishing together was routine in the validation run) drains
   at ~1 per iteration instead of being batched.
4. **Non-deterministic result under retry**: results live in a per-task *set*
   (`SADD taskId code`, `SPOP` to read). A retried task that reports twice
   with different exit codes leaves two members; `SPOP` returns one at random.
   Retries are explicitly anticipated (`wflib/index.js` comment: K8s
   "sometimes restarts a successfully completed job").
5. **Executor-side data loss** (client-lib `RedisConnector`, unfixed twin of
   the engine-side bugs patched in `f6b4703`): result `SPOP`'d *before* the
   observer check, and unobserved notifications unconditionally `SREM`'d — a
   notification that races ahead of `waitForTask()` is destroyed and the
   waiting promise hangs forever.

Items 1–3 are *structural*: they follow from "shared set + random-draw
polling" and would persist even with every implementation bug fixed.

## Verified constraints (what the design must run on)

Checked 2026-07-08 against the deployed charts and both repos:

| Component | Version | Consequences |
|---|---|---|
| Redis server (`charts/redis/values.yaml`) | `redis:5.0.7-buster` | Streams supported (5.0 introduced `XADD`/`XREADGROUP`/`XACK`/`XGROUP CREATE ... MKSTREAM`, `XADD MAXLEN ~`). **Not** available: `XAUTOCLAIM`, `XADD NOMKSTREAM` (both 6.2+) — the design must not rely on them. |
| Engine redis client (`hyperflow/package.json`) | `redis@3.1.x` (callback API) | Stream commands are exposed as generated methods (`rcl.xadd`, `rcl.xreadgroup`, …) via its `redis-commands` dependency (streams included since redis-commands 1.4, node_redis 3.1 pins ^1.7). Guaranteed fallback either way: `rcl.send_command('XREADGROUP', [...])`. Replies arrive as raw nested arrays — the consumer must parse them manually (no structured reply types in v3). |
| Engine connection topology (`common/wfRun.js:8`) | **one shared client** (`rcl`) for the whole engine | A blocking command on the shared client would stall every other engine Redis op. Any blocking reader **must** run on a dedicated second connection. |
| Job-executor client (root, `connector.js` used by `hflow-job-listener`) | `redis@3.1.1` | Same as engine: `xadd` available (or `send_command`). Producer side needs no blocking calls. |
| client-lib (`packages/client-lib`) | `redis@4.7` (promise API) | Native `xAdd`/`xReadGroup`; blocking reads need `client.duplicate()` (v4 blocks per-connection too). |
| VWR (`wms_benchmark/simulation/vwr`) | mirrors executor | Any wire-format change must be mirrored there or Track-3 protocol fidelity is broken. |

## Design: completion events on a Redis Stream (consumer group)

### Wire format

Producers replace the two `SADD`s with **one** `XADD`:

```
XADD hf:<hfId>:completions MAXLEN ~ 100000 * taskId <taskId> code <exitCode>
```

- **Key is scoped by `hfId`** — the per-engine-process `shortid`, globally
  unique across restarts — which fixes [hyperflow#93] *by construction*: a
  dead execution's stream is simply a different key that nobody reads, not a
  pollutant in the live one. Producers need **no new configuration**: `hfId`
  is position 0 of the `taskId` they already hold
  (`streamKey = "hf:" + taskId.split(':')[0] + ":completions"`).
- **The exit code rides in the event** — the per-task result key
  (`SADD taskId code`) and its `SPOP` disappear entirely. This eliminates
  cost 4 (stream entries are strictly ordered: first completion wins,
  deterministically) and the executor-side destroy-before-check bug (cost 5)
  — there is nothing to destroy; events are immutable entries.
- `MAXLEN ~ 100000` bounds memory (approximate trim is 5.0-safe). A full
  Montage2 run is ~620 events of a few dozen bytes; the bound is generous.

### Consumer

**One connector per engine *process*, not per workflow.** An engine process
can run multiple workflows concurrently (`hflow start-server`,
`bin/hflow.js`), and `global_hfid` is generated once per process
(`wflib/index.js:46`) — so the per-process stream carries every workflow's
completions. Today's per-`wfId` `jobConnectors` map (`wflib/index.js:28,215`)
exists only because the legacy *set key* is per-`wfId`; it collapses to a
single process-wide connector. Demultiplexing between workflows is free:
observers are keyed by the full `taskId`, which is globally unique across
workflows (`hfId:wfId:procId:firingId`), so one observers map serves all of
them and the `jobConnectors[taskId.split(':')[1]]` lookup
(`wflib/index.js:1434`) becomes a single reference.

`RemoteJobConnector.run()` becomes a blocking-read loop on a **dedicated
connection** (`redis.createClient(...)` duplicate of `rcl` — see topology
constraint):

```
XGROUP CREATE hf:<hfId>:completions engine $ MKSTREAM     (once, at startup)
loop:
  XREADGROUP GROUP engine main COUNT 128 BLOCK 5000 STREAMS hf:<hfId>:completions >
  for each entry: resolve observer / stash if early / dedup if repeat; XACK
```

- **`BLOCK 5000`, not `BLOCK 0`**: a finite block preserves the current
  `stop()` semantics (the loop can observe `this.running == false` at least
  every 5 s). Between events the connection sleeps server-side — zero CPU,
  zero query traffic, unlike today's 3 s `SRANDMEMBER` heartbeat.
- **`COUNT 128` batches bursts**: N simultaneous completions arrive in one
  round-trip (cost 3 gone). Delivery latency for a single completion is the
  `XADD`→wakeup path: sub-millisecond (cost 2 gone).
- **Early notifications** (event before `waitForTask()` registers) are kept in
  a small in-memory map keyed by taskId and consumed when the observer
  registers — same idea as today's post-`f6b4703` behavior, but without
  re-drawing from Redis; the event was already delivered and `XACK`'d.
  Duplicates (executor retry) hit the `handledTasks` set and are dropped;
  because the stream is ordered, "first result wins" is now deterministic.
- **Crash/restart**: entries delivered but not `XACK`'d sit in the consumer
  group's PEL. On restart *of the same engine process semantics* the consumer
  re-reads its PEL first (`XREADGROUP ... STREAMS <key> 0`) before switching
  to `>`. Note this is strictly better than today (a poll-loop crash between
  `SPOP` and promise-resolve loses the result irrecoverably). `XAUTOCLAIM` is
  not needed — there is exactly one consumer per stream — which is what makes
  the design 5.0.7-compatible.

### Connection accounting (the "many tasks awaiting completion" question)

This was a design requirement, so stating it precisely:

- **Neither the number of tasks awaiting completion nor the number of
  concurrent workflows affects connection count.** Observers are in-memory
  promise resolvers inside the engine; the single per-process blocking
  `XREADGROUP` connection serves all of them, across all workflows the
  process is running. During the validation run the engine had **~440 tasks
  simultaneously awaiting** completion (mProject fan-out); under this design
  that is still exactly one blocking connection — and a server-mode engine
  running 50 concurrent workflows is *also* one.
- Totals: engine = 2 connections per process (existing shared `rcl` + the one
  dedicated blocking reader). Each worker/executor pod: 1, unchanged (`XADD`
  is non-blocking, issued on its existing client). VWR: unchanged (1). Net
  cluster-wide delta: **+1 connection per engine process**, against Redis's
  default `maxclients` of 10 000.
- Two rejected shapes, both for connection growth: **per-task `BLPOP`**
  (blocking commands park a whole connection → ~440 parked connections at the
  observed fan-out), and — the tempting-but-wrong port of today's structure —
  **per-workflow streams** (`hf:<hfId>:<wfId>:completions` with one connector
  each), which would park one blocking connection *per concurrent workflow*
  in server mode. The per-process stream avoids both by construction.

### Rollout / compatibility (three repos must not need lockstep)

The engine and executors ship in different images and can meet in any
version combination mid-rollout, so the transport must be negotiated, not
assumed:

1. The engine advertises the transport in the job message it already sends
   (`common/jobMessage.js`): a new field, e.g. `"completionTransport":
   "stream"`. Old engines don't send it.
2. Executors (job-executor root connector, client-lib, VWR) switch on the
   field: present → `XADD`; absent → legacy `SADD` pair. New executors remain
   fully compatible with old engines.
3. The engine flips its consumer loop (and starts advertising) behind an env
   var (`HF_VAR_COMPLETION_TRANSPORT=stream`, default `set` initially),
   allowing the images to be rolled and validated independently; flip the
   default once all three producers have shipped.

VWR is a hard dependency of this plan: its Track-3 charter is byte-level
protocol fidelity with the real executor, so its `redisConnector.js` must
implement the same negotiation in the same release window.

## Alternative considered: keep the sets, fix the consumer (staged option A)

A strictly consumer-side repair — **no wire change, no executor/VWR work,
ships in `hyperflow` alone**:

1. Replace the single `SRANDMEMBER` draw with a full-batch read (`SMEMBERS`,
   or `SSCAN` if the set could be large) and process every member per
   iteration → kills cost 3 and most of cost 1's *latency* impact.
2. Discard foreign-execution orphans: the consumer knows its own `global_hfid`
   and every member embeds its origin `hfId` at position 0 — `SREM` any member
   whose `hfId` differs. This is **provably safe**: two *live* workflows can
   never share a `wf:<wfId>` key (`INCRBY wfglobal:nextId` is atomic, so
   concurrent workflows — whether in different engine processes or in one
   server-mode process — get distinct ids); a foreign `hfId` in your set is
   always a dead execution's orphan. → kills cost 1 entirely.
3. Costs 2 (3 s poll floor), 4 (SPOP nondeterminism) and 5 (client-lib bugs)
   remain; 5 should be fixed independently regardless of transport.

| | A: batch + hfId-filter (sets) | B: Streams |
|---|---|---|
| Repos touched | `hyperflow` only | `hyperflow`, `hyperflow-job-executor`, `wms_benchmark` (VWR) |
| Fixes #93 dilution | yes (filter) | yes (by construction) |
| Completion latency | ≤ 3 s (poll floor stays) | ~ms (push) |
| Burst draining | yes (batch) | yes (COUNT) |
| Deterministic result on retry | no | yes |
| Idle Redis traffic | 1 query / 3 s | none (server-side block) |
| Extra connections | 0 | +1 per engine |
| Rollout risk | trivial (consumer-only) | needs 3-repo negotiation (above) |
| Works on redis 5.0.7 / node_redis 3.1 | yes | yes (verified above; no 6.2-only commands) |

**Recommendation: A now, B as the target — the same shape as the
namespace-split decision, and for the same reason.** A is a one-file,
one-repo change that removes the operationally painful failure mode
(multi-minute stalls) immediately and is not thrown away by B (B replaces the
loop wholesale). Do B when a coordinated protocol version bump across the
three repos is scheduled anyway; its payoff (ms-latency completions,
deterministic retries, zero idle traffic) matters most for the Track-3/5
benchmark work where completion latency sits inside the measured quantity.

Independent of A/B: fix the client-lib `RedisConnector` defects (cost 5) and
consider bumping the `redis` chart image from `5.0.7-buster` (EOL) to a
current 7.x — nothing in either option requires it, but it widens future
options (`XAUTOCLAIM`, `NOMKSTREAM`) and picks up five years of fixes.

## Implementation and test plan (option B)

Implementation brief for the Streams transport. Everything below is
verified against the actual repos/images (2026-07-09); an implementer
should not need to re-derive it.

### Code scope

| Repo | File | Change |
|---|---|---|
| `~/hyperflow` | `wflib/connector.js` | Rewrite `run()` (~88 lines → similar size): `XGROUP CREATE <key> engine $ MKSTREAM` once at startup (ignore `BUSYGROUP`), drain own PEL (`XREADGROUP ... STREAMS <key> 0`), then loop `XREADGROUP GROUP engine main COUNT 128 BLOCK 5000 STREAMS <key> >` on a **dedicated duplicated connection**; per entry: resolve observer / stash in new `earlyEvents` map / drop duplicate (`handledTasks`), then `XACK`. Constructor: takes the blocking client + `hfId`; key = `hf:<hfId>:completions`; drop `wfId`/`checkInterval`. `waitForTask()`: +~5 lines — check `earlyEvents` first, resolve immediately on hit. `stop()` unchanged (finite `BLOCK` keeps it working). Result shape `[null, code]` unchanged. Keep the legacy set-polling loop intact behind the transport flag (regression path). |
| `~/hyperflow` | `wflib/index.js` | One connector **per process**, not per `wfId`: replace the `jobConnectors` map (lines 28, 215–216) with a single instance created at engine init with `global_hfid` + a duplicated client; lookup at line 1434 becomes that single reference. Advertise the transport in the job message (`common/jobMessage.js` path): field `completionTransport: "stream"` when the flag is on. Flag: env `HF_VAR_COMPLETION_TRANSPORT` (`stream` \| `set`), **default `set`**. |
| `~/hyperflow-job-executor` | `connector.js` | `notifyJobCompletion`: when the job message carries `completionTransport: "stream"`, emit one `XADD hf:<hfId>:completions MAXLEN ~ 100000 * taskId <taskId> code <code>` (`hfId = taskId.split(':')[0]`); otherwise the existing two-`SADD` pair. ~15 lines. No new deps. |
| `~/hyperflow-job-executor` | `handler.js` | Pass the flag from the parsed job message (`jm`) into the connector (construction at lines 33–34). `hasCompleted` (line 72, `wf:<wfId>:completedTasks` guard) is a different mechanism — **do not touch**. |
| out of scope this round | `packages/client-lib/redisConnector.js` (separate `work:*` pipeline; fix its data-loss bugs independently), VWR (`wms_benchmark` — must mirror the producer change before any benchmark use, but `fast-test.sh` doesn't involve it). |

Client-library note (both repos are on callback-style `redis@3.1`): stream
commands should be available as generated methods (`rcl.xadd(...)`,
`rcl.xreadgroup(...)`) via `redis-commands`; if any is missing, use
`rcl.send_command('XREADGROUP', [args...])` — semantically identical.
`XREADGROUP` replies arrive as raw nested arrays
(`[[key, [[id, [f1, v1, f2, v2]], ...]]]`) and must be parsed manually.
**Layer 1 below settles this empirically before the full loop is written —
do it first.**

### Layer 1 — wire probe on the real Redis (write this FIRST)

Purpose: prove `redis@3.1` + `redis:5.0.7` (the exact deployed image —
not 7.x) handle the four stream commands, and fix the
method-vs-`send_command` choice, in seconds of iteration time.

```bash
docker run -d --name redis-probe -p 6379:6379 redis:5.0.7-buster
```

A ~50-line throwaway script (node, `redis@3.1`) that exercises, in order:
`XGROUP CREATE ... MKSTREAM` (and re-create → expect `BUSYGROUP` error),
`XADD` with `MAXLEN ~`, `XREADGROUP ... COUNT ... BLOCK 100 ... >` (empty →
null; after XADD → parse the nested reply), `XACK`, and PEL redelivery
(`XREADGROUP ... STREAMS <key> 0` after a read without ack). Print raw
replies. Outcome feeds directly into the connector implementation.

### Layer 1.5 — transport performance benchmark (baseline FIRST, on real Redis)

**Not a Layer-0 concern**: unit tests run on `FakeRedis`
(`setImmediate`-based, nothing blocks), so timings there measure the fake,
not the transport; and the set-transport's dominant cost is the configured
3 s `checkInterval`, which a fake-clock "benchmark" would merely echo back.
Benchmark on the Layer-1 rig instead: real `redis:5.0.7-buster` in Docker,
driving the **real, unmodified connector code** from both repos (consumer:
`hyperflow/wflib/connector.js`; producer:
`hyperflow-job-executor/connector.js`) — never reimplementations.

Harness: a standalone script, e.g. `hyperflow/tests/perf/transport-bench.js`,
run manually (never in CI — timing-sensitive), parameterized by
`{transport, nTasks, nStale, checkInterval}`. **Run it against the current
code before implementing anything** — the set-transport baseline needs no
new code and pins the "before" numbers; re-run after for the comparison.

Measure four regimes separately (they have different mechanics — do not
blend them into one number):

1. **Idle→first-event latency** (the poll-floor cost): producer notifies
   once at a random moment while the consumer idles; time from
   `notifyJobCompletion()` call to promise resolution. ~200 samples,
   report p50/p95/max. Expectation: sets ≈ uniform(0, checkInterval)
   → p50 ~1.5 s; streams ~ms.
2. **Burst drain** (the observed ~440-task fan-out): register N observers,
   fire N notifications simultaneously, time until all N promises resolve.
   N ∈ {50, 440}. NOTE the current loop does **not** sleep after a
   successful draw — healthy-case drain is ~3 sequential RTTs per task, so
   expect sets to be slower but not 3 s×N; streams ≈ ceil(N/128) reads +
   acks. This regime keeps the comparison honest.
3. **Dilution** (the [hyperflow#93] failure mode): pre-load the pending set
   with K foreign-`hfId` orphans, K ∈ {0, 30, 90, 300}; measure
   time-to-resolve one live completion. Each stale draw sleeps the full
   `checkInterval`, so sets degrade ~linearly (K=90 reproduced ~4.5 min
   live); streams must show K-independence (the orphans live in a different
   key entirely).
4. **Idle overhead**: with zero completions for 60 s, count commands issued
   (`INFO commandstats` delta, or `CLIENT LIST` + command counters) and
   connections. Sets: one `SRANDMEMBER`/3 s; streams: ~0.2 empty wakeups/s
   on one parked connection.

Methodology notes: same dockerized Redis instance and same host for both
transports; WSL2 timing is noisy — use percentiles over ≥ 50 samples per
cell, not means of few runs. Optionally add a second set-mode run with
`checkInterval=100 ms` to separate the *protocol's* structural costs
(dilution, per-task RTTs) from the *configured* interval — aggressive
polling narrows regime 1 but not regime 3, and multiplies regime 4, which
is precisely the design argument in numbers.

Deliverable: a small table (regime × transport → p50/p95) checked into the
PR description or `tests/perf/RESULTS.md`, produced once from the baseline
run and once from the stream run.

### Layer 0 — unit tests (no services)

Extend `hyperflow/tests/connector.js`: add `xadd`/`xreadgroup`/`xack`/
`xgroup` to `FakeRedis`; port the four existing scenarios (normal,
duplicate-dropped, early-arrival-preserved, no-busy-poll) to the stream
loop, and add: burst of N drained in one read; multi-workflow demux (two
`wfId`s, one stream, both observers resolve); PEL redelivery after
simulated restart; legacy-flag regression (flag=`set` → old loop verbatim,
existing tests still green). Executor side: a small fake-redis test
asserting `notifyJobCompletion` emits the correct `XADD` args with the flag
and the legacy `SADD` pair without it.

### Layer 2 — end-to-end in kind via `fast-test.sh`

Rebuilding the worker image does **not** require npm publishing. The
published image installs the executor with
`npm install -g @hyperflow/job-executor@<ver>` → files live at
`/usr/lib/node_modules/@hyperflow/job-executor` (verified in the live
`hyperflowwms/montage2-worker:latest`). The diff adds no dependencies, so a
two-line overlay suffices:

```dockerfile
# in ~/hyperflow-job-executor
FROM hyperflowwms/montage2-worker:latest
COPY connector.js handler.js /usr/lib/node_modules/@hyperflow/job-executor/
```

```bash
cd ~/hyperflow && make image                      # hyperflowwms/hyperflow:latest
cd ~/hyperflow-job-executor && docker build -t hyperflowwms/montage2-worker:streams-dev -f Dockerfile.overlay .
cd ~/hyperflow-k8s-deployment
WORKER_IMAGE=hyperflowwms/montage2-worker:streams-dev ./local/fast-test.sh
```

(`fast-test.sh` already honors `HF_ENGINE_IMAGE`/`WORKER_IMAGE` and
`kind load`s them. If the executor diff ever grows npm deps, switch the
overlay to `npm pack` → `COPY` tgz → `npm install -g ./<tgz>`.)

Run the matrix, same cluster, three `hf-run` cycles:

1. **Regression** — both new images, flag unset (default `set`): behavior
   byte-identical to today; legacy sets in use; workflow green.
2. **Streams** — add to the run values overlay:
   `hyperflow-engine.containers.hyperflow.additionalVariables: [{name:
   HF_VAR_COMPLETION_TRANSPORT, value: "stream"}]`; workflow green over the
   new transport.
3. **Mixed rollout** — stream-flagged engine + stock
   `montage2-worker:latest`: documents the mismatch behavior and decides
   whether the engine needs a dual-read fallback (also poll the legacy set
   while in stream mode) or whether env-flag gating is sufficient. This is
   an open design question to be answered by this run, not assumed.

Pass criteria beyond "workflow finished" (probe with `kubectl exec` into
the redis pod mid-run):

- `XLEN hf:<hfId>:completions` > 0 and growing (stream in use);
- `XPENDING hf:<hfId>:completions engine` → 0 at quiesce (everything acked);
- `SCARD wf:<wfId>:tasksPendingCompletionHandling` **stays 0** in stream
  mode (legacy path truly idle);
- latency: per-task delta between the Job `Completed` event
  (`kubectl get events`) and the engine's `ended with result` log line —
  today averages ~1.5 s (half the 3 s poll); expect ~ms in stream mode;
- redis `CLIENT LIST | wc -l`: engine contributes exactly **2** connections
  (shared + blocking reader), independent of task fan-out.

### Known traps for the implementer

- Blocking `XREADGROUP` **must not** run on the shared `rcl`
  (`common/wfRun.js:8`) — it parks the whole connection; duplicate it.
- `BLOCK 5000`, not `BLOCK 0` — `stop()` relies on the loop regaining
  control.
- Redis is 5.0.7: **no** `XAUTOCLAIM`, **no** `XADD NOMKSTREAM` — don't use
  them; `XGROUP CREATE ... MKSTREAM` and `MAXLEN ~` are fine.
- `XGROUP CREATE` on an existing group throws `BUSYGROUP` — catch and
  ignore, it's the normal already-initialized case.
- node_redis v3 gives raw nested-array replies for `XREADGROUP` — write one
  small parser, unit-test it against the Layer-1 captured reply shape.
- The stale junk files and dirty tree conventions of
  `hyperflow-k8s-deployment` don't apply here, but both code repos may have
  local uncommitted work — commit surgically by path.

[hyperflow#93]: https://github.com/hyperflow-wms/hyperflow/issues/93

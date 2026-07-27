# InveniOps ingestion load test

Methodology-first load-testing harness for `POST /api/v1/signals` — the real
HTTP path, not the in-process `bulk-test` shortcut, so the rate limiter,
buffer, and queue all get genuinely exercised. Full design rationale below;
see `docs/loadtest-results/` for actual run output.

## Why k6, not autocannon

The system under test is itself Node/Express. A Node-based generator on the
same machine competes with it for the same runtime family's overhead, which
makes "did the generator or the server run out of headroom first" genuinely
ambiguous. More importantly: **autocannon is closed-loop** — it holds N
connections open and fires each one's next request only after the previous
resolves. Under real overload the server slows down, and a closed-loop
generator responds by automatically sending *fewer* requests — it
self-corrects away from the exact condition a "burst above capacity"
scenario needs to create. k6's `ramping-arrival-rate`/`constant-arrival-rate`
executors are open-loop: they keep attempting the configured rate regardless
of response latency, spinning up more VUs as needed. That's the only way to
honestly test "what happens when N× capacity arrives," and it's why k6 was
chosen over autocannon here.

k6 runs **inside the Docker Compose network** (`docker run --network
inveniops-ims_ims-network`), hitting `http://backend:3000` directly — not
from the Windows host through the published port, which would route through
Docker Desktop's host-networking translation layer and risk measuring that
layer instead of the backend.

**Self-bottleneck detection:** k6 reports `dropped_iterations` — if the
arrival-rate executor couldn't schedule VUs fast enough to hit the target
rate, that's a direct signal the *generator* fell behind, not the server.
Every report flags this explicitly (`edge.generatorMayHaveBottlenecked`)
rather than silently presenting the achieved rate as if it were the full
offered load.

**This is still a single-machine measurement.** The generator, backend, and
all three data stores share one machine's CPU and memory (`docker info` at
run time is recorded in every report's `environment` block). Treat every
number here as a local baseline, not a distributed-testbed result.

## Two rate limiter findings — one anticipated, one discovered while building this

The backend's default config has a **global rate limiter at 2000 signals/sec
refill, 5000 burst capacity** (`RATE_LIMIT_GLOBAL_REFILL_PER_SECOND`/
`_CAPACITY`), sitting in front of the buffer. Sustained throughput at the
assignment's stated 10,000/sec target will mostly produce `429`s from this
limiter before the buffer's own shedding logic ever gets exercised — expected
going in, and the scenarios are sized to make it visible (`sustained-ramp`
targets 3000/sec, comfortably past 2000) rather than stopping short of it.

What wasn't anticipated: there's also a **per-IP limiter, capacity 50, refill
20/sec** (`RATE_LIMIT_IP_CAPACITY`/`_REFILL_PER_SECOND`) — far stricter than
the global one. Express has no `trust proxy` configured, so `req.ip` is the
raw TCP socket address; every VU inside one k6 container shares that
container's single Docker-bridge IP. The first smoke-test run hit this
immediately: 39% `429` at a target of only 50/sec, entirely from one
container looking like one client, well before the global limiter or the
buffer were anywhere near their own limits. Confirmed by checking `res.status`
per-request, not inferred.

This is real system behavior, not a harness bug — but it made the harness, as
originally designed, an inherently poor proxy for what many independently
deployed signal producers (separate API instances, cache nodes, RDBMS
connection poolers, etc. — genuinely different source IPs in production)
would generate. Changing `RATE_LIMIT_IP_CAPACITY` would be tuning the
*system*, which "no tuning yet" rules out. So the fix is on the generator
side: **`run.js` launches `shardCount` k6 containers in parallel** (default
20, `configs/scenarios.json`), each its own container and therefore its own
bridge IP, splitting the target rate across them (`k6/loadtest.js`'s
`SHARD_COUNT`/`SHARD_INDEX`). This simulates a fleet of distinct producers
instead of one client hammering from a single address — a correction to how
the load is *generated*, not a change to what the backend does with it.

Even sharded, do the arithmetic before reading "target rate" as "delivered
rate": with `shardCount` containers, the per-IP limiter's theoretical ceiling
is `shardCount × 20`/sec sustained and `shardCount × 50` burst — every report
prints this next to its actual results so the two are never confused.

## A third finding: the generator itself has a hard ceiling on this machine, well below the assignment's 10,000/sec

Raising `shardCount` to chase past the per-IP ceiling was the obvious next
move — until `shardCount: 20` at the assignment's literal target rate
(3000/sec sustained-ramp, split across shards) produced **88% connection
failures and 108,698 dropped iterations**, while the backend's own metrics
for that same run showed almost no strain at all (peak buffer fill 5.1%,
peak queue depth 44). That gap is the tell: the *generator* collapsed, not
the system under test. Twenty parallel `docker run` containers, each
independently trying to sustain a high per-second iteration-attempt rate,
exceeded what this machine's Docker Desktop allocation (16 CPUs, but only
**~3.7GiB of memory** — `docker info` at run time, recorded in every
report's `environment` block, shared with Postgres/Mongo/Redis/the backend/
the frontend and, on this machine, a couple of unrelated legacy containers
too) can sustain — confirmed by re-testing at lower shard counts and rates
until the failure signature (`request_errors`, `dropped_iterations`)
disappeared entirely. That run's numbers (88% request_errors,
108,698 dropped_iterations, edge p99 in the tens of seconds) are **not
presented as system throughput** anywhere in this repo's results — they
measured generator collapse, not the backend, and were discarded rather
than reported as a baseline. The finding that matters is qualitative and is
recorded here: at this machine's resource allocation, `shardCount ≳ 10` at
a high per-shard offered rate is unreliable, and the validated-clean
configuration below is deliberately conservative relative to that edge.

Two things needed fixing, and both are generator-side, not backend-side —
consistent with "no tuning yet":
1. **`vuBudget()` in `k6/loadtest.js`** was over-provisioning VUs per shard
   (up to 4× peak rate) — sized down to a Little's-Law-based budget against
   this backend's actual observed healthy latency (single-digit ms), since a
   large VU pool per shard is itself real memory/scheduling load, not a free
   safety margin.
2. **`shardCount` and the offered rate** were empirically walked down —
   5, 8, 10, and 20 shards were each tested at matched per-shard rates until
   the clean/unstable boundary was found. **5 shards, ≤100/sec offered per
   shard (500/sec total)** is the validated-clean configuration `configs/
   scenarios.json` now ships as the default; every report's `warnings` array
   still flags `dropped_iterations`/`request_errors` explicitly if a given
   run crosses back over that line.

The honest consequence: this local single-machine harness cannot generate
enough *clean, un-confounded* offered load to reach the assignment's
10,000/sec figure, or even the global rate limiter's 2000/sec sustained
ceiling — reaching those would need either many more distinct machines
generating load (a real distributed rig, out of scope here) or accepting
generator-side failure as a confound in the results (which defeats the
point of an honest baseline). What this harness *does* cleanly and honestly
measure, at up to ~500/sec offered: the per-IP limiter's real behavior under
sustained and burst load, the buffer/debounce/persistence pipeline's
behavior at that rate, and the accepted-vs-persisted gap — see
`docs/loadtest-results/` for the actual numbers, and their own `warnings`
field for anything that run itself flagged.

## Measurement — mapped to its actual source

| Metric | Source | Notes |
|---|---|---|
| Accepted/sec at edge | k6 status-code counters (202) | |
| **Persisted/sec end-to-end** | Direct MongoDB query | Every signalId this run generates is tagged `lt-<runId>-...`; polled every `pollIntervalMs` for a real time series |
| Shed count by severity/reason | `ims_signals_dropped_total` diff (before/after) | Backend-authoritative |
| Rate-limited count | k6 status-code counters (429) | Not tracked in `/metrics` today — k6 is the only source |
| Latency p50/p95/p99 at edge | k6 `http_req_duration` | |
| End-to-end latency (receipt→persisted) | Two independent measurements — see below | |
| Error rate by status | k6, all status codes tallied | |
| Peak buffer fill / queue depth | Polled `/metrics` throughout, max tracked | Gauges — a before/after diff would miss a transient peak |
| Memory high-water mark | Polled `docker stats` on the backend container throughout | Real OS-level RSS, not `process.memoryUsage()` |

### Two end-to-end latency measurements, deliberately not conflated

1. **`ims_signal_e2e_latency_ms`** (backend's own histogram): recorded once
   per BullMQ *batch job*, using the **oldest** signal's wait time in that
   batch (see `backend/src/workers/signalWorker.ts`). A worst-case-in-batch
   proxy, not a true per-signal distribution — reported labeled as such.
2. **Per-signal polling sample**: a `SAMPLE_RATE` fraction of signals (default
   2%) are tagged; the orchestrator polls Mongo for their first appearance
   and diffs against a `sentAtMs` embedded in the signal's own `rawPayload`
   at generation time. Accurate to within one poll interval, but a genuine
   per-signal figure — reported alongside (1) as an independent cross-check,
   not a replacement.

## Running it

```bash
docker compose up -d                 # stack must be running
cd scripts/loadtest
npm install                          # first time only
node orchestrator/run.js --scenario sustained-ramp
```

Scenarios: `sustained-ramp`, `burst-recovery`, `mixed-components`,
`debounce-concentrated`, `debounce-spread`. Defaults live in
`configs/scenarios.json`; override any key via `--key value`, e.g.:

```bash
node orchestrator/run.js --scenario burst-recovery --spikeRate 5000
```

Each run writes `docs/loadtest-results/<timestamp>/`:
- `result.json` — the full machine-readable report
- `summary.txt` — the console summary (also printed at the end of the run)
- `k6-summary.json` — k6's own raw summary export
- `raw-samples.json` — the full polled time series (buffer/queue/memory/persisted-count/per-signal-latency), for anyone who wants to plot it

**CI regression gate**: `--min-persisted-per-sec <n>` fails the run (non-zero exit)
if the scenario's persisted/sec comes in under `<n>` — see `.github/workflows/ci.yml`
(`debounce-concentrated`, the fastest scenario) and `docs/performance.md` for why the
floor is set well below this machine's own baseline.

**`orchestrator/bulkStress.js`** is a different tool for a different question — every
scenario above is bound by the real per-IP rate limiter (~90/s aggregate across 5
shards), which is by design, but means none of them pressure-test the ingestion
pipeline itself. `bulkStress.js` drives load via `POST /signals/bulk-test` (bypasses
the rate limiter entirely) to find where the pipeline actually saturates. Not part of
the regression-gated suite — see `docs/performance.md` for the full methodology and
what it found.

## What's deliberately NOT measured this way

`bulk-test` (`POST /api/v1/signals/bulk-test`) generates signals in-process,
bypassing the rate limiter and real HTTP overhead entirely — useful for
other purposes, but it would understate exactly the layers this harness
exists to measure, so it's not used here.

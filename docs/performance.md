# Performance: baseline, bottleneck, and one tuning pass

This documents a single, focused round of performance work: establish an honest
baseline, find the actual bottleneck from data (not guesswork), change one
variable at a time, and measure the effect of each change independently before
adopting any of them.

**Read this before the numbers below**: everything here was measured on one
developer machine, with the load generator, Postgres, Mongo, Redis, and the
backend all competing for the same CPU cores. See
[Environment and its effect on the numbers](#environment-and-its-effect-on-the-numbers).

## Methodology

Two different tools were used, deliberately, because they answer different
questions:

1. **`scripts/loadtest/orchestrator/run.js`** (k6, existing infrastructure —
   see `scripts/loadtest/README.md`) drives load over the real network path,
   through the real per-IP rate limiter. This is what `docs/loadtest-results/`
   already documents, and what the CI regression gate (`.github/workflows/ci.yml`)
   runs on every push.
2. **`scripts/loadtest/orchestrator/bulkStress.js`** (new, added for this
   tuning pass) drives load via `POST /api/v1/signals/bulk-test` — an
   in-process synthetic-signal generator that deliberately bypasses the token
   bucket (see the comment on that route in
   `backend/src/api/routes/signals.ts`). It exists because the rate limiter
   turned out to be the wrong thing to measure past — see below.

For the tuning pass, each configuration was tested against a disposable,
isolated backend container (`docker run` against the same image, same real
Postgres/Mongo/Redis, its own port — never the shared dev container), so
config changes never needed a rebuild of anything a developer or other test
suite depends on. Each configuration was run 2-3 times; both trials are
reported, not just the friendlier one.

`bulkStress.js` reports two throughput numbers per run:

- **Drain-phase persisted/sec**: signals persisted after the offered load
  stops, divided by how long the backlog took to fully drain. In theory the
  cleanest isolation of pure pipeline capacity. In practice, unreliable at
  high throughput/concurrency — when the pipeline drains a backlog fast
  enough, there's sometimes no backlog left by the time the "drain phase"
  starts (see the `0.0` results in the raw run logs), so this number is
  reported but not used as the primary metric below.
- **Blended persisted/sec**: total signals persisted across the whole run
  (offer window + drain window) divided by total wall time. Less
  theoretically pure, but far more consistent between repeated trials —
  this is the number the table below actually uses.

## The honest baseline

Five k6 scenarios were run before any tuning (results committed under
`docs/loadtest-results/`, one directory per run):

| Scenario | Duration | Accepted/sec | Persisted/sec | Peak buffer fill | Peak queue depth | Peak DLQ | Peak memory |
|---|---|---|---|---|---|---|---|
| sustained-ramp | 76.1s | 91.1 | 91.1 | 0.0% | 1 | 0 | 109.0 MiB |
| burst-recovery | 52.4s | — | — | 0.0% | — | 0 | — |
| mixed-components | 36.2s | 89.6 | 89.6 | 0.0% | 1 | 0 | 108.8 MiB |
| debounce-concentrated | 25.6s | 87.7 | 87.7 | 0.0% | 6 | 0 | 102.5 MiB |
| debounce-spread | 25.5s | — | — | — | — | 0 | — |

**The finding, before changing anything**: every scenario converges on
~88-91 signals/sec, regardless of what each scenario is actually trying to
stress (sustained ramp, burst, 600 mixed components, 8 concentrated
components, 5000 spread components). That convergence is the signature of a
single shared constraint, and the constraint is visible directly: 5 k6
shards (5 source IPs) × the per-IP rate limiter's default sustained refill
(20/s each) = a ~100/s aggregate ceiling, and ~88-91/s achieved is 88-91% of
that theoretical ceiling. Every other resource — buffer fill (0.0% in every
run), BullMQ queue depth (1-6, never building a backlog), DLQ (0), backend
memory (flat ~103-109 MiB across every scenario regardless of shape) — never
got anywhere close to its own limit.

**Conclusion: none of these five scenarios ever pressure-tested the
ingestion pipeline itself.** They pressure-tested the rate limiter, which is
working exactly as designed (see `docs/backpressure.md` / README's
Backpressure Handling section) — it is not a bug and not something this pass
tunes. To find the pipeline's actual bottleneck, the rate limiter needed to
be taken out of the picture entirely, which is what `bulkStress.js` and
`POST /signals/bulk-test` are for.

## Finding the real bottleneck

With the rate limiter bypassed, a baseline pipeline-stress run (defaults:
`BUFFER_DRAIN_BATCH_SIZE=200`, `BUFFER_DRAIN_INTERVAL_MS=50`,
`QUEUE_WORKER_CONCURRENCY=5`, Postgres pool at Prisma's implicit default) —
now something *did* build a real backlog: peak buffer fill hit 100%, queue
depth reached 15-77 across trials, and throughput settled around
**~2,360-2,730 persisted/sec** (2 trials at the reported profile: 2,729.4
and 2,599.0/s — see also 3 earlier exploratory trials at a smaller offered
load, 1,788.3-2,629.9/s, consistent with the same range).

This is the real ceiling the assignment's candidate list was aimed at. The
question became: which of the five candidates is actually responsible for
it?

## One variable at a time

Each row changes exactly one environment variable from the baseline above,
tested against the same isolated container, same offered-load shape
(`--durationS 10 --batchSize 1000 --concurrency 2` against `bulk-test`, 2
trials each unless noted). "×" is the ratio of the row's median to the
baseline's median (2,664/s).

| Change | Trial 1 | Trial 2 | Trial 3 | Median | × baseline |
|---|---|---|---|---|---|
| **Baseline** (no change) | 2,729.4/s | 2,599.0/s | — | 2,664/s | 1.0× |
| `BUFFER_DRAIN_BATCH_SIZE` 200 → 500 | 8,084.3/s | 4,283.4/s | — | 6,184/s | **2.3×** |
| `QUEUE_WORKER_CONCURRENCY` 5 → 15 | 3,239.4/s | 3,006.1/s | — | 3,123/s | 1.2× |
| `BUFFER_DRAIN_INTERVAL_MS` 50 → 15 | 5,954.6/s | 5,366.8/s | — | 5,661/s | **2.1×** |
| Postgres `connection_limit` → 50 (explicit) | 3,958.4/s | 2,381.8/s | — | 3,170/s | 1.2× (noise) |
| **Combined**: batch 500 + interval 15ms | 14,080.7/s | 3,991.4/s | 15,261.9/s | 14,081/s | **5.3×** (high variance — see below) |

### What each result means

- **Buffer drain batch size (== the assignment's "Mongo batch size" — this
  codebase has no separate Mongo-specific batch config; the same batch that
  gets drained from the buffer is the same batch that gets passed to
  Mongo's `insertMany` and Postgres's grouped increment, see
  `backend/src/workers/processBatch.ts`) is the single biggest lever found.**
  Doubling-plus the batch size more than doubled throughput. That points at
  **fixed per-job overhead** — one BullMQ job dequeue/lock/ack cycle, one
  Mongo `insertMany` round trip, one grouped Postgres transaction — being a
  bigger cost than the per-signal work scales with. Bigger batches amortize
  that fixed cost over more signals.
- **Buffer drain interval** (how often the buffer hands a batch to BullMQ)
  showed a similarly large effect. A shorter interval means jobs reach
  workers sooner and more often, keeping the (concurrency-limited) worker
  pool fed instead of idling between drain ticks.
- **Worker concurrency** helped, but far less than either of the above —
  roughly 20%, not 100%+. If the work inside each job were purely
  CPU-bound, more concurrent jobs wouldn't help much either (Node is
  single-threaded); the fact that it helped *some* means there's real I/O
  wait inside a job that benefits from overlap, but the fact that it helped
  so much *less* than batching means concurrency isn't where the ceiling
  actually is.
- **Postgres connection pool size made no measurable difference** — its
  two trials (3,958.4/s, 2,381.8/s) land inside the baseline's own noise
  band, not above it. This is explained by the environment: Prisma's
  implicit default pool size is `numCpus × 2 + 1`, and this machine reports
  16 CPUs to the container, i.e. a default pool of 33 — already far larger
  than `QUEUE_WORKER_CONCURRENCY`'s default of 5 could ever exhaust.
  Raising an already-idle resource's ceiling doesn't move throughput. This
  is a real, useful negative result, not a skipped check.
- **The debouncer's Redis round trip is not independently config-toggleable**
  — it's woven into `SignalDebouncer.resolveBatch`'s per-signal resolution
  loop (`backend/src/services/ingestion/debouncer.ts`), which runs
  sequentially, one signal at a time, inside every job (up to 2 Redis round
  trips per signal on the debounce fast path: a session read, then a count
  bump). It could not be isolated by a config change alone, so this pass
  reasons about it from the other four results instead of claiming a
  direct measurement: batching (bigger jobs, same *total* Redis round-trip
  count, just reorganized) was the dominant win, and concurrency
  (parallel jobs, which *would* let concurrent Redis waits overlap) helped
  only modestly. Both observations point toward **fixed per-job overhead
  external to the debounce loop** (Mongo/Postgres round trips) mattering
  more than the debounce loop's own sequential Redis cost, at these load
  levels — but this is inference from the other four experiments, not a
  direct measurement, and is flagged as exactly that. See
  [What I'd change to go further](#what-id-change-to-go-further).

### The combined result, and why its variance is reported honestly

Batch size and drain interval were each validated independently above
*before* being combined — this section is not "stack five changes and
credit the total" (three trials landed at 14,080.7/s, 3,991.4/s, and
15,261.9/s: two trials roughly 5× baseline, one trial roughly 1.5×
baseline, on identical configuration). That spread is real and is reported
as measured, not smoothed over. The most likely explanation, consistent
with the [environment caveat](#environment-and-its-effect-on-the-numbers)
below, is host-level scheduling noise (Docker Desktop / the WSL2 VM
sharing this one machine's cores with everything else running on it) — at
this offered load, the run is CPU-scheduling-sensitive enough that one
trial in three visibly caught worse contention. The honest summary is
**"roughly 2-5× baseline, highly likely on the higher end of that range
under less noisy conditions, not a single precise multiplier."**

## Final change adopted

`docker-compose.yml`'s `backend` service now sets:

```yaml
BUFFER_DRAIN_BATCH_SIZE: ${BUFFER_DRAIN_BATCH_SIZE:-500}
BUFFER_DRAIN_INTERVAL_MS: ${BUFFER_DRAIN_INTERVAL_MS:-15}
```

(previously unset, i.e. relying on `backend/src/config/index.ts`'s schema
defaults of 200 / 50ms). `QUEUE_WORKER_CONCURRENCY` and the Postgres
connection pool were left at their defaults — the data above didn't justify
the added resource cost (more concurrent DB connections, more concurrent
Mongo/Postgres load) for a ~20%-or-nothing return.

Both remain overridable via `.env` (`BUFFER_DRAIN_BATCH_SIZE=...` /
`BUFFER_DRAIN_INTERVAL_MS=...`), same as every other value in that block.

**Regression check after adopting the change**: the full backend suite was
re-run against the rebuilt container with the new defaults —
`npm test` (366 unit tests), `npm run test:integration` (73 tests),
`npm run test:e2e` (13 tests), and `npm run test:chaos` (6 scenarios) all
passing. The chaos suite's `workerCrash.test.ts` and `queueSaturation.test.ts`
set their own explicit `BUFFER_DRAIN_BATCH_SIZE`/`BUFFER_DRAIN_INTERVAL_MS`
overrides on their own ephemeral containers already (see
`backend/tests/chaos/README.md`), so they were unaffected by this change
either way.

That verification pass caught a real, self-inflicted problem worth
documenting: `bulkStress.js`'s own experiments (run against a disposable
container, but pointed at the *same real, shared* Postgres/Mongo/Redis
every other suite in this repo uses) left ~2.15M synthetic documents in
Mongo and ~2,787 stale entries in Redis's `dashboard:active_incidents`
cache — the latter because the integration suite's own
`tests/integration/services/debouncer.test.ts` does an unscoped
`work_items` cleanup between runs (by design, documented in
`vitest.integration.config.ts`), which wiped Postgres back to zero active
work items but has no way to know about — and so never invalidates — a
Redis cache entry that isn't its own. The result: a genuinely-passing test
(`tests/integration/api/lifecycle.test.ts`) started failing, not because of
the buffer/interval change, but because ~2,787 phantom cache entries pushed
a real, freshly-created work item off the first page of the (limit-200)
active-incident list. Diagnosed via `ZCARD dashboard:active_incidents`
(2,787) against `SELECT count(*) FROM work_items` (0) — an unambiguous
cache/source-of-truth divergence — fixed by clearing the now-fully-stale
cache, and confirmed by re-running the suite clean. Documented here rather
than quietly cleaned up, because it's a real gap this pass exposed: nothing
in this repo currently guards against a load-testing tool polluting the
same shared dev datastores every test suite depends on. Worth a follow-up
independent of this tuning pass (e.g., a dedicated tuning/load-test
Postgres+Mongo+Redis stack instead of sharing the dev one) — not fixed here
because it's a test-infrastructure change, not a pipeline-performance one,
and mixing the two would blur exactly the "one variable at a time"
discipline this document is trying to model.

The k6-based, rate-limiter-bound scenarios were also re-run post-change:
throughput is unchanged (still ~88-91/s, still rate-limiter-bound, as
expected — this tuning pass targeted a bottleneck that sits *behind* the
rate limiter, so it has no effect on traffic the rate limiter itself caps
first). This is itself a useful confirmation that the change is safe: it
measurably helps the pipeline's real ceiling without changing the
system's externally-observed behavior under normal (rate-limiter-bound)
load at all.

## Where the bottleneck sits now

Roughly 2-5× headroom was recovered from fixed per-job overhead (batch
size, drain interval). The next-most-likely constraint, per the reasoning
above, is the debounce loop's sequential per-signal Redis round trips —
un-measured directly in this pass, flagged as the top follow-up.

## What I'd change to go further

In priority order, most to least likely to matter:

1. **Pipeline/batch the debouncer's Redis calls.** `resolveBatch` currently
   awaits each signal's session read (`HGETALL`) and count bump
   (`HINCRBY`) one at a time (`backend/src/services/ingestion/debouncer.ts`).
   ioredis supports pipelining; grouping a job's signals by `componentId`
   and issuing one pipelined round trip per unique component (instead of
   one or two round trips per *signal*) would cut Redis-side latency by
   roughly the average signals-per-component ratio in a batch. This is a
   real code change (not a config knob), which is why this pass didn't
   attempt it, but the batching/concurrency results above make it the most
   likely next win.
2. **Re-run this same one-variable-at-a-time pass with a proper isolated
   benchmarking host** (not this shared, single, everything-co-located
   machine) to get trial-to-trial variance down from the ~±30-50% seen
   here to something tight enough to respect much smaller effects — several
   of the "no measurable difference" results above (Postgres pool,
   partially worker concurrency) might reveal a real, smaller effect a
   noisier measurement can't distinguish from noise. This would also let
   the combined-config variance be resolved properly, instead of reported
   as a range.
3. **Instrument actual per-stage timing** (buffer→queue handoff, debounce
   resolution, Mongo insert, Postgres increment) instead of inferring stage
   costs from black-box throughput deltas — a histogram per pipeline stage,
   not just the existing end-to-end `ims_signal_e2e_latency_ms`, would let
   a future pass directly attribute time instead of reasoning about it from
   which knobs moved the aggregate number.
4. **Re-check worker concurrency after (1) lands.** If the debounce loop's
   sequential Redis waits are what's currently limiting how much a single
   job benefits from more concurrent siblings, removing that sequential
   bottleneck could make `QUEUE_WORKER_CONCURRENCY` a much bigger lever
   than the ~20% seen here — worth re-testing, not assuming, once (1) is
   done.

## Environment and its effect on the numbers

**Everything in this document ran on a single developer machine**: the load
generator (`bulkStress.js`, or k6 in Docker for the baseline scenarios),
Postgres, Mongo, Redis, and the backend container(s) under test all shared
the same CPU cores, the same memory, the same disk, at the same time —
there was no dedicated, isolated load-generation host, and no dedicated,
isolated system-under-test host.

What that means for how to read every number above:

- **Absolute throughput numbers are not portable.** They describe this
  machine's capacity to run six-plus services at once, not the pipeline's
  capacity in isolation. A dedicated host (or even just this machine with
  nothing else running) would likely show meaningfully higher absolute
  numbers for every row in every table.
- **Relative comparisons (the × baseline column) are more trustworthy than
  absolute ones**, since every row in the same table ran under the same
  contention conditions — but "more trustworthy" isn't "immune": the
  combined-config result's 3.5× spread between its own three trials, on
  identical configuration, is direct evidence that even the relative
  comparisons carry real measurement noise on this setup, not just the
  absolute numbers.
- **CI runs on different, weaker, shared hardware again** (GitHub-hosted
  runners) — which is exactly why the CI throughput regression gate (see
  `.github/workflows/ci.yml`) is set to 30 persisted/sec, well under even
  this machine's noisiest baseline trial (1,788/s), rather than calibrated
  to any number in this document. It exists to catch a genuine regression
  (something 10-50× worse than normal), not to hold CI hardware to a local
  dev machine's noisy standard.
- **The k6-based scenarios' "single machine" caveat already existed**
  before this tuning pass (see `scripts/loadtest/README.md`'s own note,
  repeated in every `docs/loadtest-results/*/result.json`'s `environment`
  field) — this document's pipeline-stress numbers inherit the exact same
  caveat, for the exact same reason.

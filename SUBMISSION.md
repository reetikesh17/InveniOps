# Submission notes

A cover note, not a spec restatement — the assignment is [docs/assignment.md](docs/assignment.md),
the full write-up is [README.md](README.md), and every design decision has an ADR in
[docs/decisions/](docs/decisions/). This is just: what got built, what it measures at,
what I'd point to first, and what I'd change with more time.

## What was built

An incident management system for a distributed stack: signals (errors/latency spikes
from RDBMS, API, cache, queue, MCP host, and NoSQL components) are ingested over HTTP,
accepted into a bounded in-memory buffer without ever blocking on persistence, debounced
so a burst from one failing component collapses into a single work item, persisted to
three purpose-specific stores (Postgres for work items/RCA, MongoDB for the raw signal
audit log and time-series aggregations, Redis for hot-path dashboard state), routed to
an alert with a component-specific severity floor, and tracked through a state machine
that cannot reach CLOSED without a complete root-cause analysis — enforced in the domain
layer, not the API layer. A React dashboard exposes the live feed, incident detail with
linked raw signals, the RCA form, and an analytics view with a live backpressure/health
panel. `/health` and a 5-second console throughput line satisfy the observability
requirement; a chaos suite (`backend/tests/chaos/`) exercises six real failure modes
(Postgres/Redis/Mongo outages, queue saturation, a `SIGKILL`'d worker, graceful shutdown
mid-request) against the actual Docker Compose stack, not mocks.

## Measured numbers

- **Rate-limited, well-behaved-client throughput** (the real ingestion API, real
  per-IP/global token buckets in front): ~88-91 signals/sec sustained — this is what
  a client that respects 429s actually achieves, and it's rate-limiter-bound by design,
  not pipeline-bound.
- **Pipeline capacity with the rate limiter bypassed** (`bulkStress.js`, isolating the
  buffer→queue→debounce→Mongo/Postgres pipeline itself): baseline median **2,664
  persisted/sec**; after one tuning pass (`BUFFER_DRAIN_BATCH_SIZE` 200→500,
  `BUFFER_DRAIN_INTERVAL_MS` 50→15) median **14,081 persisted/sec**, a 5.3× improvement,
  though with real trial-to-trial variance (3,991-15,262/s across three runs on a
  single shared dev machine — see [docs/performance.md](docs/performance.md) for the
  full one-variable-at-a-time table and why the variance is reported honestly instead
  of smoothed over).
- **Concurrency correctness**: 50 simultaneous state-transition requests against one
  work item, 25 independent iterations, exactly one `200` and forty-nine `409`s every
  single time (`backend/tests/e2e/concurrency.test.ts`) — zero races, by optimistic
  concurrency (a guarded `UPDATE ... WHERE state = fromState`), not locking.
  60 concurrent × 8 iterations proves the same for debounce work-item creation.
- **Test suite**: 366 backend tests across 31 files, 54 frontend tests across 2 files,
  all passing. Six chaos scenarios, all passing (~76-143s total).

## What I'm most pleased with

The debounce design's two-tier honesty: a Redis session is the fast path, but the
actual correctness guarantee is a Postgres partial unique index
(`idx_work_items_active_component_id`) — if two requests raced past the Redis check
simultaneously, the database still only lets one insert win, and
`debouncer.test.ts` proves it under real concurrency rather than assuming Redis is
enough. It would have been easy to ship the Redis-only version and have it look
correct in every manual test while being wrong under real contention.

Close second: the chaos suite earned its keep. It wasn't theater — it found three real
bugs before they'd have been real incidents: `PostgresWorkItemRepository.findById`
wasn't wrapped in the retry helper everything else was, the rate limiter's fail-open
path needed an explicit Redis `commandTimeout` to engage fast enough under a genuine
outage, and the dashboard cache needed a `CacheUnavailableError` to tell a real Redis
outage apart from an ordinary cache miss. All three were found by running the actual
failure, not by code review.

## What I'd do differently

- **Establish frontend linting on day one, not as a last-pass retrofit.** The frontend
  had zero ESLint/Prettier configuration until this final pass — formatting had quietly
  drifted, and one real bug (a stale `eslint-disable` comment no longer covering the
  line it was written for, after a prior reformat shifted it) sat undetected in the
  backend for the same reason: `eslint-config-prettier` only silences conflicting
  *lint* rules, it doesn't run Prettier itself, so "lint passes" and "formatting is
  consistent" turned out to be two different claims that had quietly diverged.
- **Pipeline the debouncer's Redis calls.** `resolveBatch` currently awaits each
  signal's session read and count bump one at a time; ioredis pipelining, grouped by
  `componentId`, is the identified next throughput win and the one tuning change this
  pass didn't attempt because it's a real code change, not a config knob.
- **Pin down the assignment's literal "10,000 signals/sec" figure as one sustained,
  reproducible number**, not two different numbers measured two different ways (a
  rate-limiter-bound client figure and a rate-limiter-bypassed pipeline figure). Doing
  that properly needs a dedicated, isolated load-generation host — everything here ran
  on one shared dev machine, load generator and system-under-test on the same cores.

## Known limitations, stated plainly

1. **The Live Feed and Incident Detail screens have zero frontend component tests.**
   Frontend test coverage (54 tests) is entirely scoped to the RCA form — deliberately,
   because it's the one screen with real client-side logic worth unit-testing in
   isolation — but that leaves two of the three UI surfaces genuinely untested at the
   component level, backed only by the APIs they call being well-tested.
2. **The 10,000 signals/sec target was never cleanly demonstrated as a single number.**
   See above — what exists is a rate-limited client number (~90/s, by design) and a
   rate-limiter-bypassed pipeline number (2,664-14,081/s depending on tuning), and
   conflating them would be dishonest even though the second number clears 10k on its
   best trials.
3. **Every performance number in this repo comes from one shared, non-isolated
   development machine.** The relative comparisons (× baseline) are more trustworthy
   than the absolute figures; the CI throughput regression gate is deliberately set to
   30/s — well under even the noisiest observed baseline trial — specifically because
   it has to survive GitHub Actions' shared runners, not this machine.

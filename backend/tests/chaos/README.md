# Chaos / resilience tests

Automates the failure scenarios that would otherwise only get exercised by
hand: pausing/stopping/killing the real Docker containers this system
depends on, mid-load, and asserting on concrete data-integrity outcomes —
not just "the process didn't crash."

## Running

```bash
docker compose up -d          # the real stack must already be running
npm run test:chaos
```

**Expected runtime: ~1.5-3 minutes for the full suite** (measured; see
below — the range is wide because of `workerCrash.test.ts`, see its own
note), run sequentially (`fileParallelism: false` in
`vitest.chaos.config.ts` — every file disrupts and restores the *same*
shared containers, so two files running at once would corrupt each
other's "is Postgres up right now" assumptions). Per file, actually
measured:

| File | What it does | Measured runtime |
|---|---|---|
| `queueSaturation.test.ts` | Floods an isolated backend instance past buffer capacity | ~3s |
| `slowPersistence.test.ts` | Pauses Mongo mid-load, waits for the backlog to drain | ~18s |
| `postgresOutage.test.ts` | Stops Postgres during an active transition, restarts it | ~10s |
| `redisOutage.test.ts` | Stops Redis, checks dashboard/rate-limiter degradation | ~17s |
| `workerCrash.test.ts` | SIGKILLs an isolated backend instance mid-job, waits for BullMQ's stalled-job recovery | **~7s to ~90s** (variable — see below) |
| `gracefulShutdown.test.ts` | SIGTERMs an isolated backend instance under load, confirms the drain hook ran | ~7s |

`workerCrash.test.ts` is the long pole, and genuinely variable: across 4
repeated runs it landed at ~7s, ~9s, ~68s, and ~85s. That variance is
real BullMQ stalled-job recovery timing (not a flaky test) — how long the
crashed worker's lock takes to be noticed as expired depends on exactly
when in BullMQ's internal lock-renewal/stalled-check cycle the SIGKILL
landed, which this test deliberately doesn't control (shortening BullMQ's
~30s lock/stalled-check defaults to make every run fast would mean
testing different, less realistic, timing than production actually has).
The suite's 180s per-file timeout comfortably covers the worst case
observed.

This is why these are a separate `npm run test:chaos`, not part of
`npm test` or `npm run test:integration`: they're slow by nature (waiting
out real retry windows, real health-probe intervals, real BullMQ recovery
timing) and they deliberately take down real containers — not something
that should run on every save, or even every CI push without being asked
for.

## What each scenario asserts (not just "didn't crash")

- **Slow persistence** (Mongo `pause`, not `stop` — freezes the process via
  cgroups so connections hang rather than refuse, closer to a real
  degraded-network condition than a clean refusal): ingestion keeps
  returning 202 within a tight latency budget the whole time Mongo is
  frozen (proving the buffer genuinely decouples ingestion from
  persistence, not just "eventually"), the backend process stays alive,
  its memory stays bounded, and — the actual data-integrity claim — every
  signalId accepted during the outage is confirmed present in Mongo once
  it's unpaused, by direct query, not inferred from a lack of errors.
- **Postgres outage**: asserts the retry wrapper's own log lines appear
  (attempt number, delay, error code) — added logging in
  `src/repositories/postgres/withPostgresRetry.ts` specifically because
  retries were previously silent — then that `/health` reports 503 naming
  Postgres, that a failed transition leaves the work item's `updatedAt`
  byte-for-byte unchanged (not partially applied), and that the identical
  transition succeeds once Postgres is back, with zero manual steps in
  between. This also caught a real gap: `PostgresWorkItemRepository.findById`
  — the read every transition does *before* its guarded write, to fetch
  current state — wasn't wrapped in `withPostgresRetry` at all, unlike the
  writes, so a transient Postgres blip failed the whole transition attempt
  immediately with no retry and no log line. Now wrapped, same as the
  writes.
- **Redis outage**: asserts `GET /api/v1/incidents` still returns 200 with
  correct data sourced from Postgres (not 500) — this required a real fix,
  not just a test: `DashboardCacheRepository` now throws a distinguishable
  `CacheUnavailableError` on a genuine Redis failure (vs. returning
  null/empty for an ordinary cache miss), and `DashboardProjectionService`
  catches specifically that to read Postgres directly, because the
  pre-existing "empty cache → repopulate → reread" logic would otherwise
  silently report zero active incidents against an unreachable cache. Also
  asserts the rate limiter fails **open** (ingestion isn't blocked by a
  non-critical dependency — see the justification comment on
  `checkRateLimitFailOpen` in `src/api/routes/signals.ts`), and that it's
  not stuck open once Redis recovers (a real burst gets 429'd again).
- **Queue saturation**: asserts the buffer's watermark actually engages
  (`buffer.shedding`/fill fraction crossing the high-water mark), that
  `ims_signals_dropped_total{severity="P3"}` is nonzero while
  `severity="P0"` stays exactly zero even under sustained pressure, and
  that a dedicated P0-only batch submitted *while the buffer is still
  under pressure* comes back 202 in full — not inferred from buffer.ts's
  unit tests, exercised for real over HTTP. Runs against a temporary,
  isolated backend instance (see `helpers/ephemeralBackend.ts`) so it can
  reach buffer capacity in seconds without the shared dev container's rate
  limiter (or its 20,000-signal buffer) making the test impractically slow
  — the code under test is identical, just configured for a fast,
  reproducible run.
- **Worker crash**: in this codebase the BullMQ worker runs in-process
  with the API (`src/index.ts` — one container, no separate worker
  service), so "kill a worker mid-job" means SIGKILLing the whole backend
  process and relying on BullMQ's own stalled-job recovery once a new
  instance starts polling the same Redis-backed queue. Runs against an
  isolated ephemeral backend: elevated rate limits (a single 500-signal
  batch costs 500 tokens against the real per-IP bucket, which a bucket of
  default capacity 50 can never admit regardless of timing), a fast small
  buffer drain (so the buffer empties in ~100-200ms — every signal becomes
  a durable BullMQ job in Redis quickly), and concurrency forced to 1 so
  those ~20 resulting jobs process strictly serially — deliberately slower
  than they arrive, so a real backlog still exists once the buffer's
  already empty, not a coin flip on exact timing. The test explicitly
  waits for the buffer to fully empty *before* it ever looks for a job to
  kill: killing earlier would race the buffer's own non-durable in-memory
  state, which is a real, expected loss window this system was never
  designed to survive, and conflating that with BullMQ's job-level
  recovery would prove the wrong thing. Whether a job is genuinely active
  at kill time is confirmed via a direct, live BullMQ query
  (`Queue#getActiveCount()`) against Redis — not `/health`'s
  `queue.activeCount`, which is a cached probe refreshed on its own
  background interval and produced real observed flakes when polled for
  this. Asserts every signal from the in-flight batch eventually persists
  (nothing lost across the crash) **and** that no signalId appears more
  than once in Mongo (idempotency — `insertManyIdempotent`'s dedup — held
  even though the job may have partially completed before the kill).
- **Graceful shutdown**: also runs against an isolated ephemeral backend
  (same rate-limit reasoning as worker crash — one 500-signal batch always
  exceeds the real per-IP bucket). Sends SIGTERM under active load and
  asserts the shutdown hook's own log line
  (`"drained ingestion buffer on shutdown"`) actually appears — proof this
  recovered via the intended drain path, not merely by coincidentally
  surviving via the same stalled-job mechanism `workerCrash.test.ts`
  exercises — then that every signal accepted before the signal arrived is
  eventually persisted after restart. The ingest request is fully awaited
  before SIGTERM is sent (not raced concurrently with it) — racing them
  risks Docker tearing down the container's port forwarding mid-response,
  truncating it before the app's own shutdown sequence even starts, which
  would be a test-harness artifact rather than the thing under test; the
  202 response itself is near-instant, so the batch is still realistically
  draining through the buffer/queue when SIGTERM follows a moment later.

## Design notes

- Every test restores the container(s) it touched in `afterEach`/`afterAll`
  regardless of pass/fail (`try/finally` around the disruptive action), and
  `beforeEach`/`beforeAll` hooks also call `ensureRunning` defensively —
  a test file can be run on its own, immediately after an interrupted
  previous run, without manual cleanup.
- Tests run on the host against the real containers' published ports (same
  posture as `tests/integration/`), using `docker`/`docker exec`-equivalent
  CLI calls (`tests/chaos/helpers/docker.ts`) — not Testcontainers or any
  other abstraction — because the point is to disrupt the *actual*
  docker-compose stack a developer or CI runs, not a parallel one.
- `queueSaturation.test.ts`, `workerCrash.test.ts`, and
  `gracefulShutdown.test.ts` are the exceptions to "use the real stack":
  each needs a differently-configured instance (elevated rate limits,
  and for queue saturation a small buffer too) to be practical to run in
  CI time at all — a single request submitting hundreds of signals in one
  batch costs that many tokens against the real dev container's per-IP
  rate limiter (default capacity 50), which no amount of timing can work
  around. Each spins up (and always tears down) an isolated second
  container sharing the same real Postgres/Mongo/Redis — see
  `helpers/ephemeralBackend.ts` for the full reasoning. `slowPersistence.test.ts`,
  `postgresOutage.test.ts`, and `redisOutage.test.ts` disrupt the real
  shared dev containers directly, since they don't need elevated limits
  (their signal volumes are individually small, well under the real rate
  limiter's capacity).

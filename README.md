# InveniOps — Incident Management System (IMS)

Distributed systems fail in pieces: a cache node degrades, a queue backs up, an RDBMS
connection pool exhausts, and each piece emits its own flood of error and latency
signals faster than a human can read them. InveniOps ingests those signals at high
volume without blocking on persistence, collapses repeated noise from the same failing
component into a single trackable work item, routes it to the right responder at the
right severity, and enforces a workflow that cannot reach "Closed" without a documented
root cause — turning raw signal noise into a small number of accountable incidents with
a measured Mean Time To Repair.

## Demo

**The console now lives at `/app`, not `/`** — `/` is a public landing page (`/login`
and `/signup` are also public; everything else in the console is behind auth, see
[Auth](#auth--backendsrcapiroutesauthts-mounted-at-apiv1auth) below). Signing in or
signing up lands you in the console at `/app` automatically.

![InveniOps landing page — the debounce mechanic animated live, not asserted in copy](docs/images/landing-page.png)
**Landing page** (`/`) — the hero *is* the argument: a live, client-side demo of the
same 100-signal / 10-second debounce rule the backend enforces, collapsing into a real
`IncidentRow` (see [ADR 0013](docs/decisions/0013-landing-page-design-direction.md) for
the design direction and what it deliberately doesn't claim). Entirely self-contained —
no API call, so it renders identically with the backend stopped — and every number on
the page below the fold (throughput, buffer capacity, debounce window) is quoted from
this README's own [Performance](#performance) and [Backpressure](#backpressure-handling)
sections, not restated from memory.

45 seconds, full workflow: a signal arrives in the Live Feed, the incident opens, its
linked raw signals expand, it transitions OPEN → INVESTIGATING → RESOLVED, closing it
without an RCA is rejected in place, a valid RCA is submitted, and it closes with a
computed MTTR. Recorded against the [cascading-failure scenario](#sample-data), not
placeholder data — see [docs/demo-script.md](docs/demo-script.md) for the same walkthrough
scripted for a live five-minute run.

<video src="docs/images/demo.mp4" controls muted playsinline width="100%">
Your viewer doesn't render inline video — the file is at
<a href="docs/images/demo.mp4">docs/images/demo.mp4</a>.
</video>

|  |  |
|---|---|
| ![Live Feed — mixed severity, not all P0](docs/images/live-feed.png) | ![Live Feed — dark theme](docs/images/live-feed-dark.png) |
| **Live Feed** — active incidents, severity-then-recency, real-time via SSE. This run's mix (P0 down to P3) comes straight out of the cascading-failure scenario, not hand-picked | Same screen in the dark theme — a first-class alternative, not a colour-inverted afterthought |

|  |  |
|---|---|
| ![Incident Detail with the transition timeline and expanded raw signals](docs/images/incident-detail.png) | ![RCA form with the live MTTR preview](docs/images/rca-form-mttr-preview.png) |
| **Incident Detail** — the transition timeline (every state change, who made it, when) alongside the expanded raw-signal payloads linked to this incident from Mongo | **RCA form** — appears in place once a work item reaches RESOLVED (there is no separate RCA route): start/end pickers, a live MTTR preview computed from the real first-signal timestamp and ticking every second, a category dropdown, and the three narrative fields with character minimums |

|  |  |
|---|---|
| ![Analytics — populated charts, non-null MTTR](docs/images/analytics.png) | ![System status panel mid-shedding](docs/images/system-status-shedding.png) |
| **Analytics** — signal throughput, incident volume by component/severity, MTTR trend, and worst-first component health, all computed from this same run's closed incidents | **System status under active backpressure** — the same panel a few minutes later, mid-burst from `scripts/loadtest/orchestrator/bulkStress.js`: buffer pinned at 100%, shedding lit up, the backpressure design in [docs/backpressure.md](docs/backpressure.md) made visible rather than inferred |

The 5-second throughput line ([docs/observability.md](docs/observability.md#reading-the-console-line))
during that same burst — buffer fill and queue depth rising under load, then draining
back to idle once the offered load stops:

![Backend console: buffer fill and queue depth moving under a burst, then draining](docs/images/terminal-throughput.png)

The visual system exists to be read at 3am by an on-call engineer, not to look good in
a portfolio: colour is rationed to severity alone (nothing else in the UI is
saturated), severity splits warm P0/P1 vs. cool P2/P3 so urgency is legible before
reading the code, every text/background pairing in both themes is WCAG AA-checked with
a script rather than eyeballed, and the app is responsive at 375/768/1440px. Full
rationale: [ADR 0008](docs/decisions/0008-console-visual-system.md). Every reusable
primitive — badges, buttons, form fields, the full type scale — is catalogued at
[`/styleguide`](frontend/src/features/styleguide/StyleGuidePage.tsx); it is a
**development artifact for reviewing the design system in isolation**, not a product
feature — it is deliberately not linked from the app's own navigation, only reachable
by typing the URL.

## Quickstart

Three commands, from a fresh clone, to a running system with a populated dashboard.
Requires Docker Desktop (or a compatible engine) with Compose v2, and Node.js 20+ on
the host — the second command applies the Postgres schema from outside the container,
and the third installs and runs the sample-data scripts.

```bash
# 1. Build and start Postgres, Mongo, Redis, the backend API, and the frontend dev server
docker compose up -d --build

# 2. Apply the Postgres schema (the backend image doesn't run migrations on boot —
#    see backend/Dockerfile — so this is a one-time, explicit step), then seed one
#    demo login so you can sign in without signing up first
cd backend && DATABASE_URL=postgresql://ims_user:ims_password@localhost:5432/ims npx prisma migrate deploy && \
  DATABASE_URL=postgresql://ims_user:ims_password@localhost:5432/ims JWT_SECRET=local-dev-only-insecure-secret-do-not-use-in-production npx prisma db seed && cd ..

# 3. Populate the dashboard: a narrated cascading-failure scenario (RDBMS outage → API
#    timeouts → MCP host failure → cache miss storm → recovery), then walk half its
#    incidents to CLOSED with a real RCA and MTTR
cd scripts/scenarios && npm install && npm run cascading-failure -- --speed 30 && npm run replay-lifecycle && cd ../..
```

Open **http://localhost:5173** — this is the landing page; click **Sign in** (or go
straight to http://localhost:5173/login) and sign in with the seeded demo account —
**`demo@inveniops.dev`** / **`Demo12345!`** (a fixed, publicly-known demo credential,
not a real secret; sign up your own account instead if you'd rather). That lands you
in the console at **http://localhost:5173/app**. The Live Feed shows a mix of active
incidents and, on the Closed tab, resolved ones with real computed MTTR; Analytics has
real throughput and MTTR data to chart.
`curl http://localhost:3000/health` should report `"status":"healthy"` with all four
dependencies `up` (no auth required for `/health` itself — see
[API Reference](#api-reference)). Step 3's scenario runs in ~10 seconds at `--speed 30`;
drop the flag (`npm run cascading-failure`) to watch it narrate in real time over ~3
minutes instead — see [Sample Data](#sample-data) for what it verifies and why.

**Other useful commands:** `make logs` (`docker compose logs -f`), `make down`,
`make reset` (`docker compose down -v` — destructive, wipes volumes),
`make db-shell` (a `psql` shell into the Postgres container). `cp .env.example .env`
first if you want to override any port, credential, or `VITE_API_BASE_URL` — the
compose file's own defaults match what's used above, so it's optional.

## Architecture

```mermaid
graph LR
    Sources["Signal Sources<br/>APIs · MCP Hosts · Caches<br/>Queues · RDBMS · NoSQL"]
    RateLimit{"Rate Limiter<br/>(Redis token bucket,<br/>per-IP + global)"}
    Ingest["Ingestion API<br/>(Express)"]
    Buffer["Ring Buffer<br/>(severity-aware shedding)"]
    Queue[("Queue<br/>BullMQ / Redis")]
    Workers["Signal Workers"]
    Mongo[("MongoDB<br/>signals — audit log")]
    MongoMetrics[("MongoDB<br/>timeseries metrics")]
    Postgres[("PostgreSQL<br/>work_items · rca_records")]
    Redis[("Redis<br/>dashboard cache")]
    IncidentsAPI["Incidents API<br/>(transition, RCA)"]
    AnalyticsAPI["Analytics API"]
    AlertDispatcher["Alert Dispatcher<br/>(Strategy pattern)"]
    Escalation["Escalation Scheduler"]
    Channels["Console · Slack ·<br/>PagerDuty · Email"]
    Dashboard["Dashboard UI<br/>(React, SSE)"]

    Sources -->|"HTTP POST, JSON<br/>single or array"| Ingest
    Ingest -->|"per-IP + global<br/>token check"| RateLimit
    RateLimit -->|"read/write tokens<br/>(fails open if Redis is down)"| Redis
    Ingest -->|"if allowed: buffer<br/>and ack 202 immediately"| Buffer
    Buffer -->|"debounced signal batch<br/>(drain interval)"| Queue
    Queue -->|"dequeued signal job"| Workers
    Workers -->|"raw signal document"| Mongo
    Workers -->|"Work Item create/link<br/>+ state (txn)"| Postgres
    Workers -->|"dashboard state<br/>write-through"| Redis
    Workers -->|"batched volume/creation<br/>metric points"| MongoMetrics
    Workers -->|"once, on work<br/>item creation"| AlertDispatcher
    IncidentsAPI -->|"transition / RCA (txn)"| Postgres
    IncidentsAPI -->|"on every transition"| AlertDispatcher
    IncidentsAPI -->|"transition + MTTR<br/>metric points"| MongoMetrics
    IncidentsAPI -.->|"SSE push on<br/>create/transition"| Dashboard
    Escalation -->|"overdue OPEN items"| AlertDispatcher
    Escalation -->|"audit trail row"| Postgres
    AlertDispatcher -->|"fan out, per-channel<br/>retry + timeout"| Channels
    AlertDispatcher -->|"dispatch outcome"| MongoMetrics
    Redis -->|"active incidents,<br/>per-incident summary"| Dashboard
    Mongo -->|"raw signals<br/>(Incident Detail)"| Dashboard
    IncidentsAPI -->|"incident state, RCA"| Dashboard
    MongoMetrics -->|"bucketed aggregation<br/>pipelines"| AnalyticsAPI
    AnalyticsAPI -->|"throughput, volume,<br/>MTTR trend"| Dashboard

    classDef store fill:#eef2ff,stroke:#6366f1,color:#1e1b4b;
    class Mongo,MongoMetrics,Postgres,Redis,Queue store;
    classDef alerting fill:#fef2f2,stroke:#ef4444,color:#7f1d1d;
    class AlertDispatcher,Escalation,Channels alerting;
    classDef gate fill:#fffbeb,stroke:#d97706,color:#78350f;
    class RateLimit gate;
```

Ingestion never touches Postgres, Mongo, or Redis on the request path except the rate
limiter's own token-bucket check (and that check fails *open*, not closed, if Redis
itself is unreachable — see [Backpressure Handling](#backpressure-handling)): a signal
is validated, rate-checked, buffered in process memory, and acknowledged, all before
anything durable happens. A BullMQ worker drains the buffer on an interval, resolves
debounce sessions, and only then writes to the three stores. The Incidents API is the
one other write path (state transitions and RCA submission), always transactional
against Postgres. See [docs/architecture.md](docs/architecture.md) for the full
write-path/read-path breakdown and [docs/decisions/](docs/decisions/) for why each
store holds what it holds.

## Tech stack

| Choice | Why | Main alternative rejected |
|---|---|---|
| Node.js 20 + TypeScript (strict) | Single-language stack, compile-time safety across API/domain/infra boundaries | Plain JavaScript — no compile-time guarantees on a codebase this layered |
| Express | Minimal, unopinionated HTTP layer with a mature middleware ecosystem (helmet, cors, pino-http) | Fastify — faster, but no functional need here outweighs Express's ubiquity and lower review friction |
| PostgreSQL 16 + Prisma | ACID transactions for work-item state transitions; typed schema and migrations | Raw `pg` + hand-written SQL — more control, no compile-time query safety, much more boilerplate |
| MongoDB 7 | Schemaless, high-throughput audit log for arbitrary raw signal payloads, plus native time-series collections for the aggregation sink | Postgres JSONB column — would couple burst signal-write throughput to the transactional store |
| Redis 7 | Sub-millisecond hot-path reads for dashboard state; also backs the queue and the rate limiter's token buckets | In-process cache — doesn't survive restarts or scale past one instance |
| BullMQ | Redis-backed job queue; reuses infra already in the stack, built-in retry/backoff and stalled-job recovery | RabbitMQ — a second broker to run and monitor with no capability this system needs that BullMQ lacks |
| React 18 + Vite + TypeScript + Tailwind | Fast dev loop, no build config, utility CSS with no library lock-in | Next.js — server-rendering/routing machinery this internal SPA doesn't need |
| Docker Compose | One-command reproducible local stack | Manually-installed host services — worse reproducibility for a reviewer |
| Vitest | Native ESM/TS, fast, same tool front and back | Jest — slower under ESM+TS, more config |
| zod | Runtime validation with inferred static types from one schema definition | Manual checks / Joi — no free TS type inference |
| pino | Structured JSON logs, low overhead, pairs directly with pino-http for request-id correlation | Winston — more configurable, slower, more boilerplate for structured output |

## Backpressure Handling

Full design writeup: [docs/backpressure.md](docs/backpressure.md). Load-test
methodology and the tuning pass referenced in [Performance](#performance) below live
in [docs/performance.md](docs/performance.md).

**The problem.** The assignment requires absorbing bursts up to 10,000 signals/sec
without the system crashing when Postgres, Mongo, or Redis is momentarily slow.
`POST /api/v1/signals` therefore never touches any of those three on the request path
— it hands each signal to a bounded in-memory buffer
(`backend/src/services/ingestion/buffer.ts`) and acks immediately; a BullMQ worker
persists asynchronously afterward.

**The ring buffer.** Four fixed-capacity circular buffers, one per severity (P0-P3),
each preallocated at the *full* configured capacity (`BUFFER_CAPACITY`, default
20,000) — not `capacity / 4` — so a legitimate single-severity flood still works
without resizing. A single shared invariant, enforced one level up, is what actually
bounds memory: `totalSize` across all four queues never exceeds `BUFFER_CAPACITY`, so
peak memory is a fixed constant regardless of arrival rate.

**Watermarks.** A high/low pair (0.8 / 0.5 by default) with hysteresis, not one
threshold — shedding turns on at the high mark and only turns back off once drained
below the low mark, so the buffer can't flap between states on every request near a
single boundary.

**Severity-aware shedding.** Below the high-water mark, no severity has a ceiling —
any one can grow to the full shared capacity. Once shedding engages, each *non-P0*
severity is additionally capped at a fraction of total capacity (P1 0.7, P2 0.4, P3
0.15 by default) — smallest for P3, largest for P1 — so low-severity signals run out of
their reserved room and get rejected first, in priority order, without any active
cross-queue eviction logic on the hot path. P0 is exempt from ceiling shedding
entirely; the only way a P0 signal is ever dropped is the separate, absolute
hard-capacity path (evicting the oldest lower-severity item to make room), which only
reaches P0 itself in the pathological case of 20,000 consecutive unconsumed P0s.

**What the caller observes at each stage.**

| Stage | Buffer state | Response |
|---|---|---|
| Normal | below the high-water mark | `202 { accepted, signalIds }` |
| Shedding | above high-water, a non-P0 signal beyond its severity's ceiling | `503 { error: "buffer_saturated", accepted, dropped }` — signals that *did* fit are still buffered |
| Hard capacity | buffer completely full | same `503 buffer_saturated` shape; a P0 evicts the oldest lower-severity item instead of being rejected |

Every drop is counted by severity and reason (`shed_ceiling` / `hard_capacity` /
`sink_failure`) and surfaced on `GET /health`, `GET /metrics`
(`ims_signals_dropped_total`), and a console throughput line printed every 5 seconds —
no signal is ever silently lost. A consumer loop drains batches in strict priority
order into the BullMQ queue, and a graceful-shutdown hook drains whatever's left before
the process exits.

**Measured, not just designed** — `backend/tests/chaos/` exercises every stage above
against the real running stack, not a simulation, and asserts on data integrity rather
than "the process didn't crash":
`slowPersistence.test.ts` pauses the real Mongo container mid-burst and confirms
ingestion keeps returning `202` inside a tight latency budget for the whole outage,
then confirms every accepted `signalId` is actually present in Mongo once Mongo is
unpaused, by direct query. `queueSaturation.test.ts` floods an isolated instance until
the watermark engages and confirms, from the backend's own counters, that
`ims_signals_dropped_total{severity="P3"}` is nonzero while `severity="P0"` stays
exactly zero — then submits a dedicated P0-only batch *while the buffer is still under
pressure* and confirms it's still accepted in full. `redisOutage.test.ts` stops Redis
and confirms the rate limiter's fail-open path engages fast (under 3 seconds, not the
5+ seconds ioredis's default reconnect backoff would otherwise cost) and that the
dashboard degrades to reading Postgres directly instead of erroring. All six chaos
scenarios, what each one asserts, and their measured runtimes are in
[backend/tests/chaos/README.md](backend/tests/chaos/README.md).

## Design Patterns

Full mechanics, the real interfaces, and a concrete extension walkthrough for both —
exactly what files change to add a new state or component type, and what doesn't:
[docs/design-patterns.md](docs/design-patterns.md).

**State** (`backend/src/domain/state/`) — one class per lifecycle state
(`OpenState`, `InvestigatingState`, `ResolvedState`, `ClosedState`), each declaring its
own legal outbound transitions as a `Map`, not a switch. `ResolvedState` is the only
one constructed with a guard — `createRcaCloseGuard` — which is the actual mechanism
behind CLOSED being unreachable without a complete RCA: it's enforced inside
`domain/state/` itself, not by the API layer choosing to check first.
[ADR 0009](docs/decisions/0009-state-pattern-for-work-item-lifecycle.md).

**Strategy** (`backend/src/domain/alerting/`) — one class per component type
implementing `AlertStrategy`, resolved via `AlertStrategyRegistry`'s `Map` lookup,
never a switch on `componentType` anywhere in the domain — enforced by a test that
statically scans for one and fails the build if it appears. A signal's own reported
severity and the strategy's floor are reconciled by taking whichever is more urgent
([ADR 0006](docs/decisions/0006-severity-reconciliation-rule.md)), so an under-reported
RDBMS failure still pages at P0. Full per-component floor/channel/escalation table:
[docs/alerting.md](docs/alerting.md).
[ADR 0004](docs/decisions/0004-strategy-pattern-for-alert-policy.md).

Both patterns share the same shape: a common interface, one class per concrete case,
and a lookup instead of conditional dispatch — the thing that makes "add a new case"
additive instead of a diff to existing, already-tested code.

## Performance

Full methodology, every intermediate result, and what's next:
[docs/performance.md](docs/performance.md). This section reports only what was
actually measured.

**Environment, stated plainly:** every number below came from one developer machine —
the load generator (k6 in Docker, or the in-process `bulk-test` stress tool), Postgres,
Mongo, Redis, and the backend all shared the same CPU cores and memory at the same
time. There was no dedicated, isolated load-generation host and no dedicated,
isolated system-under-test host. Absolute numbers describe this machine's capacity to
run six-plus services at once, not the pipeline's capacity in isolation — see
[docs/performance.md's environment section](docs/performance.md#environment-and-its-effect-on-the-numbers)
for the full caveat, including a measured 3.5× variance between three trials of the
*same* configuration.

**Real HTTP path, through the rate limiter** (k6, 5 sharded source IPs, results
committed under [docs/loadtest-results/](docs/loadtest-results/)):

| Scenario | Duration | Accepted/sec | Persisted/sec |
|---|---|---|---|
| `sustained-ramp` | 76.1s | 91.1 | 91.1 |
| `mixed-components` (600 components) | 36.2s | 89.6 | 89.6 |
| `debounce-concentrated` (8 components) | 25.6s | 87.7 | 87.7 |

Accepted and persisted match exactly in every run (zero gap) — nothing the edge
accepted was ever lost before landing in Mongo. All three converge on ~88-91/s
regardless of what each scenario is shaped to stress, which is the signature of a
single shared constraint: 5 k6 shards × the per-IP rate limiter's default sustained
refill (20/s each) ≈ a 100/s aggregate ceiling, and ~88-91/s achieved is 88-91% of it.
Buffer fill stayed at 0.0% and queue depth never exceeded 6 in any of these runs — the
rate limiter, working as designed, was the only thing under real pressure.

**Raw pipeline capacity, rate limiter bypassed** (`POST /signals/bulk-test`, an
in-process synthetic-signal generator built for exactly this — see
`scripts/loadtest/orchestrator/bulkStress.js`): with the rate limiter out of the way,
a real backlog forms (buffer fill hit 100%, BullMQ queue depth reached into the
hundreds) and throughput settles at **~2,664 persisted/sec** (median of 2 trials) with
the schema's default buffer settings (`BUFFER_DRAIN_BATCH_SIZE=200`,
`BUFFER_DRAIN_INTERVAL_MS=50`). Testing each candidate bottleneck independently —
batch size, worker concurrency, drain interval, Postgres pool size — found batch size
alone (200→500) and drain interval alone (50ms→15ms) to be the dominant levers, 2.3×
and 2.1× baseline respectively, with worker concurrency and Postgres pool size non-
factors at this load (Prisma's implicit pool of 33 was never close to exhausted by a
concurrency of 5). Raising `BUFFER_DRAIN_BATCH_SIZE` to 500 and lowering
`BUFFER_DRAIN_INTERVAL_MS` to 15 together — now the defaults in `docker-compose.yml` —
measured **3,991-15,262 persisted/sec across 3 trials (median ~14,081, ~5.3× baseline)**;
that trial-to-trial spread is reported as measured, not smoothed over, and is
discussed honestly in the doc rather than presented as one precise multiplier. The
full backend test suite was re-run against the tuned config with no regressions, and
the k6 scenarios above were re-confirmed unchanged post-tuning, since that bottleneck
sits behind the rate limiter these scenarios are actually bound by.

## Testing

**Unit tests** (`backend/tests/unit/`, `npm test`): 366 tests across 31 files, zero
I/O, run in a few seconds. Coverage is enforced, not just reported —
`vitest.config.ts` sets a threshold (85% statements, 90% branches, 78% functions, 85%
lines) scoped to `src/domain/**`, `src/services/**`, and the retry/Prisma-error
utilities, and a plain `npm test` fails the run if actual coverage drops below it.
Measured coverage as of this writeup: **88.9% statements, 91.62% branches, 83.24%
functions, 88.9% lines** — all above threshold with headroom. The two areas the rubric
names explicitly are both at 100%: **RCA validation**
(`domain/rca/validateRca.test.ts` — every rule, every boundary case, every
`RootCauseCategory` enum member, multiple simultaneous failures returning every field
error) and **retry logic** (`utils/retry.test.ts`,
`repositories/postgres/{prismaErrors,withPostgresRetry}.test.ts` — succeeds first try /
after N transient failures / exhausts and throws, exponential backoff timing and
jitter asserted against the actual random draw, and every Prisma error code the
wrapper classifies tested individually). Also at 100%: the work item state machine
(every legal and illegal transition) and alert strategy resolution.

**Integration tests** (`backend/tests/integration/`, `npm run test:integration`,
requires the Dockerized stores running): 73 tests across 10 files — the debouncer's
real Postgres-unique-index correctness under actual concurrency (60 simultaneous
signals × 8 iterations, exactly one work item every time), the full
ingest→debounce→alert→dashboard-cache pipeline, repository round-trips against real
Postgres/Mongo, the rate limiter, and the SSE event bus.

**E2E tests** (`backend/tests/e2e/`, `npm run test:e2e`, requires the real
docker-compose stack running, ~30s): 13 tests across 2 files — full-lifecycle
correctness against the actually deployed backend over its real HTTP API: 500 signals
across 5 components collapsing into 5 work items (not 500), correct Mongo linkage,
alerting-Strategy severity reconciliation, dashboard-cache-vs-Postgres consistency, the
full OPEN→INVESTIGATING→RESOLVED→CLOSED lifecycle with RCA validation and MTTR, and a
concurrency test firing 50 simultaneous transitions at one work item across 25
iterations to prove exactly one ever wins and the other 49 get `409`.

**Chaos / resilience tests** (`backend/tests/chaos/`, `npm run test:chaos`, requires
the real docker-compose stack running, ~1.5-3 min measured): 6 scenarios that pause,
stop, and kill the real containers — Postgres outage, Redis outage, a paused Mongo,
queue saturation, a mid-job worker crash (SIGKILL, relying on BullMQ's own stalled-job
recovery), and a graceful-shutdown drain (SIGTERM) — each asserting a concrete
data-integrity outcome, not just "didn't crash." Full write-up, including exactly what
each scenario asserts and why one of them (`workerCrash.test.ts`) has genuinely
variable runtime (7-90s, real BullMQ recovery timing, not flakiness):
[backend/tests/chaos/README.md](backend/tests/chaos/README.md).

**Frontend tests** (`frontend/`, `npm test`): 54 tests across 2 files — RCA validation
logic mirrored from the backend's rules, and RCA form behavior (character minimums,
draft persistence, unsaved-changes warning).

**CI** (`.github/workflows/ci.yml`): lint, typecheck, unit tests (coverage-gated),
frontend typecheck/tests, then integration + E2E + a short load test with a
throughput-regression floor, all against the real stack — on every push and PR. The
chaos suite runs on manual trigger only (`workflow_dispatch`), not on every push,
because it's disruptive by design (it kills the containers the workflow just brought
up) and its runtime is genuinely variable rather than a fit for a fast PR gate — the
workflow file documents the full reasoning inline.

## Sample Data

The assignment asks for "a script or JSON file to mock a failure event across the
stack (e.g., simulating an RDBMS outage followed by an MCP failure)."
`scripts/scenarios/` has both: a narrated, replayable **cascading failure** scenario,
and a companion script that walks the resulting incidents through the full lifecycle
to `CLOSED` — the exact scripts run in [Quickstart](#quickstart) above.

`cascading-failure.json` is the canonical, static event sequence, inspectable without
running anything; `cascading-failure.ts` replays it exactly as written, narrating each
beat to the console: baseline traffic across all 6 component types, an RDBMS
connection-pool exhaustion ramping from a trickle to a flood, three dependent APIs
timing out, an MCP host failing, a cache miss storm, partial recovery, and steady
state. It then verifies — against the real system, not inferred — that debouncing
collapsed the RDBMS burst into exactly one work item (enforced by a Postgres partial
unique index, not just the Redis debounce fast path), that the alerting Strategy's
severity floor corrected an intentionally under-reported RDBMS signal up to P0 while
other components' alerts passed through at their own floor, that every signal linked
to the right work item, and that the buffer absorbed the whole burst with zero drops.
`replay-lifecycle.ts` then walks the 6 failure-narrative work items through
INVESTIGATING → RESOLVED → a real, validating RCA (computing a real MTTR from each
item's actual `firstSignalAt`), and deliberately leaves the 6 healthy baseline work
items `OPEN` — so the dashboard shows both active incidents and closed ones with real
MTTR, not an empty analytics page. Both scripts are safe to re-run against the same
stack; full detail on flags and what gets verified is in
[`scripts/scenarios/README.md`](scripts/scenarios/README.md).

## API Reference

All bodies are JSON. `ComponentType` = `API | MCP_HOST | CACHE | QUEUE | RDBMS | NOSQL`.
`Severity` = `P0 | P1 | P2 | P3`. `WorkItemState` = `OPEN | INVESTIGATING | RESOLVED | CLOSED`.

### Signals — `backend/src/api/routes/signals.ts`, mounted at `/api/v1/signals`

| Method & path | Request | Response |
|---|---|---|
| `POST /` | A single signal object or a JSON array: `{ signalId?, componentId, componentType, severity, rawPayload: any, occurredAt: ISO-8601 }` | `202 { accepted, signalIds? }` · `400 { error: "validation_error", details }` · `429 { error: "rate_limited" }` (+ `Retry-After`) · `503 { error: "buffer_saturated", accepted, dropped }` — see [Backpressure Handling](#backpressure-handling) |
| `POST /bulk-test` (disabled when `NODE_ENV=production`) | `{ count, componentId?, componentType?, severity? }` — generates synthetic signals in-process, bypassing the rate limiter, for pipeline load testing without a network generator | `202 { accepted }` · `400 validation_error` |

Every response carries `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`
headers (per-IP token bucket, backed by Redis).

### Auth — `backend/src/api/routes/auth.ts`, mounted at `/api/v1/auth`

Public — these are how a token is obtained in the first place, not gated behind
themselves. Everything below this section (`/api/v1/incidents`, `/api/v1/analytics`)
requires `Authorization: Bearer <token>` from a successful signup/login; `/health`,
`/ready`, `/metrics`, and `/api/v1/signals` above stay public — see
[ADR 0012](docs/decisions/0012-jwt-authentication.md) for why ingestion specifically is
deliberately not behind the same gate.

| Method & path | Request | Response |
|---|---|---|
| `POST /signup` | `{ email, password (min 8 chars), name }` | `201 { user, token }` · `409 duplicate_email` · `400 validation_error` |
| `POST /login` | `{ email, password }` | `200 { user, token }` · `401 invalid_credentials` (same body for a wrong password and an unknown email — deliberately) · `429 rate_limited` (per-IP and per-email token buckets) |
| `GET /me` | — (requires auth) | `200 User` |
| `POST /logout` | — (requires auth) | `200 { ok: true }` — no server-side session to invalidate (stateless JWT); the client discarding its in-memory token is the actual logout |

`User`: `{ id, email, name, role: "RESPONDER" \| "ADMIN", createdAt }`. Access tokens
expire after 15 minutes (`JWT_ACCESS_TOKEN_TTL_SECONDS`) — there is no refresh-token
flow yet, stated as scope in the ADR above, not a gap found later.

### Incidents (workflow) — `backend/src/api/routes/workitems.ts`, mounted at `/api/v1/incidents` (requires auth)

`IncidentSummary`: `{ id, componentId, componentType, severity, state, title, firstSignalAt, signalCount, updatedAt }`

| Method & path | Request | Response |
|---|---|---|
| `GET /` | query `limit`, `offset`, `status=active\|closed` (default `active`) | `200 { items: IncidentSummary[], total, limit, offset }` — `active`: non-CLOSED, severity then age, from the Redis cache; `closed`: CLOSED, most-recently-closed first, from Postgres |
| `GET /:id` | — | `200` `IncidentSummary & { legalNextStates: WorkItemState[], rca: RcaSummaryDto \| null }` · `404 not_found` |
| `GET /:id/signals` | query `limit`, `offset`, `order=asc\|desc` | `200 { items: SignalDto[], total, limit, offset }` — raw signals from Mongo · `404 not_found` |
| `GET /:id/transitions` | — | `200 { items: StateTransitionDto[] }` — full audit trail, oldest first |
| `POST /:id/transition` | `{ toState }` | `200 IncidentSummary` · `404 not_found` · `409 invalid_transition` (illegal per the state machine) · `409 conflict` (optimistic-concurrency race) · `400 validation_error` |
| `POST /:id/rca` | `{ incidentStartTime, incidentEndTime, rootCauseCategory, rootCauseDescription, fixApplied, preventionSteps }` | `200` `IncidentSummary & { mttrSeconds }` · `404 not_found` · `422 { error: "invalid_rca", errors: [{field,message}] }` · `409 invalid_state` (not currently RESOLVED) · `400 validation_error` |
| `GET /stream` | Server-Sent Events (`text/event-stream`) | Long-lived connection; `work_item_created` and `work_item_state_changed` events, each `{ type, incident: IncidentSummary, fromState?, toState? }`; a heartbeat comment keeps proxies from buffering the stream |

`RcaSummaryDto`: `{ incidentStartTime, incidentEndTime, rootCauseCategory, rootCauseDescription, fixApplied, preventionSteps, mttrSeconds, submittedAt }`.
`rootCauseCategory` is one of `CODE_DEFECT | INFRASTRUCTURE_FAILURE | CONFIGURATION_ERROR | CAPACITY_EXHAUSTION | EXTERNAL_DEPENDENCY | NETWORK | HUMAN_ERROR | UNKNOWN`.

### Analytics — `backend/src/api/routes/analytics.ts`, mounted at `/api/v1/analytics` (requires auth)

Full design: [docs/data-model.md](docs/data-model.md). Every response is bucketed
server-side by a MongoDB aggregation pipeline — nothing is fetched raw and summed in
Node.

| Method & path | Request | Response |
|---|---|---|
| `GET /throughput` | `from`, `to` (ISO-8601), `interval` (seconds, default 60) | `200 { from, to, intervalSeconds, points: [{ bucket, componentId, severity, count }] }` |
| `GET /incidents` | `from`, `to`, `interval`, `groupBy=componentType\|severity` | `200 { ..., groupBy, points: [{ bucket, value, count }] }` |
| `GET /mttr` | `from`, `to`, `interval`, `groupBy=componentType\|severity` | `200 { ..., groupBy, points: [{ bucket, value, avgMttrMs, rollingAvgMttrMs, sampleCount }] }` — rolling average is a trailing 5-bucket window |
| `GET /components/:id` | query `windowSeconds` (default 3600) | `200 { componentId, windowSeconds, recentSignalCount, avgMttrMs, openWorkItemsByState }` |

All four return `400 validation_error` for a missing/malformed `from`/`to`/`interval`/`groupBy`.

### Observability — see [docs/observability.md](docs/observability.md) for full detail

| Method & path | Response |
|---|---|
| `GET /health` | `200` (all critical dependencies up) or `503` (one or more down) — per-dependency status/latency, buffer state, queue depth, DLQ size, uptime, version, throughput |
| `GET /ready` | `200` once the buffer drainer and BullMQ worker are actually running, `503` otherwise — distinct from `/health`, see docs/observability.md |
| `GET /metrics` | `200 text/plain` — Prometheus exposition format |

## Project structure

```
InveniOps/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # WorkItem, RcaRecord, StateTransition + enums
│   │   └── migrations/          # init, plus the active-component partial unique index
│   ├── src/
│   │   ├── api/
│   │   │   ├── app.ts           # Express app: helmet, cors, body limit, logging, error handling
│   │   │   └── routes/          # signals, workitems, analytics, health, ready, metrics, incidentStream (SSE)
│   │   ├── config/               # zod-validated env config — one frozen typed object, fails fast on boot
│   │   ├── domain/                # Pure business logic, zero I/O
│   │   │   ├── state/              # State pattern — work item lifecycle
│   │   │   ├── alerting/           # Strategy pattern — severity floor + channel per component type
│   │   │   └── rca/                # RCA validation + MTTR calculation
│   │   ├── rateLimit/              # Redis-backed per-IP/global token bucket
│   │   ├── repositories/           # Prisma/Mongo/Redis clients + typed repositories, one per store
│   │   ├── services/                # Orchestration: ingestion buffer, debouncer, alerting delivery,
│   │   │                            #   dashboard projection, aggregation, workflow, realtime SSE
│   │   ├── workers/                 # BullMQ consumer: debounce → persist → cache → alert → metrics
│   │   ├── utils/                   # logger (pino), retry (backoff wrapper), metrics registry
│   │   └── index.ts                 # Bootstrap: connect clients, start server + worker, graceful shutdown
│   ├── tests/
│   │   ├── unit/                    # 366 tests, zero I/O
│   │   ├── integration/             # 73 tests, real Postgres/Mongo/Redis, in-process app
│   │   ├── e2e/                     # 13 tests, real docker-compose stack over HTTP
│   │   └── chaos/                   # 6 scenarios — pause/stop/kill real containers, own README
│   └── Dockerfile                   # multi-stage: deps → build (prisma generate + tsc) → runtime
├── frontend/
│   ├── src/
│   │   ├── components/               # Reusable primitives — Button, Card, SeverityBadge, StateBadge, form fields…
│   │   ├── features/
│   │   │   ├── incidents/             # Live Feed, Incident Detail, state controls, transition timeline
│   │   │   ├── rca/                   # RCA form (rendered inside Incident Detail once RESOLVED)
│   │   │   ├── analytics/             # Throughput/volume/MTTR panels, system status
│   │   │   └── styleguide/            # Component catalogue — dev artifact, see Demo section
│   │   ├── hooks/                     # useIncidents (SSE + polling), useSystemHealth, useTheme
│   │   ├── lib/api.ts                 # Typed fetch wrapper, error normalization
│   │   └── types/enums.ts             # Hand-mirrored backend enums — checked for drift by
│   │                                  #   tests/unit/frontendTypesParity.test.ts on every backend `npm test`
│   └── Dockerfile                     # dev-mode: vite dev server, hot reload via bind mount
├── scripts/
│   ├── loadtest/                      # k6 scenarios + orchestrator; bulkStress.js for rate-limiter-bypassed
│   │                                  #   pipeline stress testing — see Performance
│   └── scenarios/                     # cascading-failure.ts + replay-lifecycle.ts — see Sample Data
├── docs/                              # design docs + ADRs — see Documentation below
├── prompts/                           # intended home for prompts/specs/plans used to build this repo
├── .github/workflows/ci.yml           # lint, typecheck, unit, integration, E2E, load-test gate; chaos on manual trigger
├── docker-compose.yml                 # postgres, mongo, redis, backend, frontend
├── Makefile                           # up / down / logs / reset / db-shell
└── .env.example
```

## Documentation

Every design document lives in [`docs/`](docs/):

| Document | What it covers |
|---|---|
| [architecture.md](docs/architecture.md) | The layered `routes → services → repositories` structure, and the full write-path/read-path breakdown per store |
| [design-patterns.md](docs/design-patterns.md) | State and Strategy with the real interfaces, and a concrete extension walkthrough for each — exactly what files change and what doesn't |
| [backpressure.md](docs/backpressure.md) | The complete backpressure design — buffer, watermarks, shedding — condensed in this README's own section above |
| [data-model.md](docs/data-model.md) | How the same incident data is shaped differently in Postgres, Mongo, and Redis, and why each store holds what it holds |
| [alerting.md](docs/alerting.md) | The per-component severity-floor/channel/escalation table, severity reconciliation, deduplication, and delivery/retry behavior |
| [observability.md](docs/observability.md) | The `/health`, `/ready`, `/metrics` contract, and how none of them ever block a request on a live dependency call |
| [performance.md](docs/performance.md) | Full load-test methodology, the honest rate-limiter-bound baseline, the one-variable-at-a-time tuning pass, and what's next |
| [requirements-traceability.md](docs/requirements-traceability.md) | Every requirement in the assignment mapped to the file, test, and doc section that satisfies it — including an honest accounting of what's partially met |
| [demo-script.md](docs/demo-script.md) | A five-minute live walkthrough — exact commands, what to point at, what to say, including the two moments worth pausing on |
| [assignment.md](docs/assignment.md) | The original assignment spec this system was built against |
| [loadtest-results/](docs/loadtest-results/) | Raw, committed output (JSON + console summaries) from every k6 baseline run performance.md references |
| [decisions/0001](docs/decisions/0001-postgres-for-source-of-truth.md) | Why PostgreSQL is the source of truth for work items and RCA |
| [decisions/0002](docs/decisions/0002-mongodb-for-signal-audit-log.md) | Why MongoDB holds the raw signal audit log |
| [decisions/0003](docs/decisions/0003-bullmq-for-async-queue.md) | Why BullMQ for the async signal-processing queue |
| [decisions/0004](docs/decisions/0004-strategy-pattern-for-alert-policy.md) | Why the Strategy pattern for alert policy, specifically |
| [decisions/0005](docs/decisions/0005-mongodb-timeseries-for-aggregation.md) | Why native MongoDB time-series collections back the aggregation sink |
| [decisions/0006](docs/decisions/0006-severity-reconciliation-rule.md) | Why a severity floor is a minimum, never a cap, and what that prevents |
| [decisions/0007](docs/decisions/0007-sse-for-real-time-transport.md) | Why Server-Sent Events, not WebSockets, for the dashboard's live updates |
| [decisions/0008](docs/decisions/0008-console-visual-system.md) | The visual system's full rationale — palette, type, density, the WCAG audit |
| [decisions/0009](docs/decisions/0009-state-pattern-for-work-item-lifecycle.md) | Why the State pattern for work item lifecycle transitions, specifically |
| [decisions/0010](docs/decisions/0010-redis-fast-path-with-postgres-backstop-for-debouncing.md) | Why debouncing is a two-tier design — Redis fast path, Postgres unique index as the actual guarantee |
| [decisions/0011](docs/decisions/0011-optimistic-concurrency-for-state-transitions.md) | Why optimistic concurrency (guarded `UPDATE`), not locking, protects state transitions |
| [decisions/0012](docs/decisions/0012-jwt-authentication.md) | Stateless short-lived JWT, no refresh token yet, in-memory token storage, and why ingestion stays keyless — every auth tradeoff, stated |
| [decisions/0013](docs/decisions/0013-landing-page-design-direction.md) | What the landing page optimises for, why it extends the console's tokens instead of inventing a brand, and the two hero directions rejected |

Also relevant, outside `docs/`: [backend/tests/chaos/README.md](backend/tests/chaos/README.md)
(what each chaos scenario asserts), [scripts/loadtest/README.md](scripts/loadtest/README.md)
(k6 methodology and the `bulkStress.js` pipeline tool), and
[scripts/scenarios/README.md](scripts/scenarios/README.md) (the sample-data scripts' flags).

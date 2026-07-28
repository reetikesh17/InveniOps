# Architecture

How the system is layered, where every concern lives, and how a signal moves from an
HTTP request to a queryable incident. See [design-patterns.md](design-patterns.md) for
the State/Strategy pattern mechanics referenced below, [data-model.md](data-model.md)
for what each store actually holds, [backpressure.md](backpressure.md) for the
ingestion buffer this doc's write path passes through, and [decisions/](decisions/) for
why each individual choice was made.

## Layered structure

The backend is layered `routes → services → repositories`, with a separate `domain/`
that neither layer is allowed to skip around:

- **`api/`** (`src/api/`) — Express routes and middleware. Parses and validates HTTP
  input (zod), calls a service, shapes the HTTP response. No direct Postgres/Mongo/
  Redis calls here.
- **`services/`** (`src/services/`) — orchestration. Coordinates one or more
  repositories and domain objects to carry out a use case: ingesting a signal
  (`services/ingestion/`), resolving a debounce session, dispatching an alert
  (`services/alerting/`), projecting the dashboard's read model
  (`services/dashboard/`), writing aggregation points (`services/aggregation/`),
  publishing real-time events (`services/realtime/`).
- **`repositories/`** (`src/repositories/`) — the only layer that talks to Postgres,
  Mongo, or Redis. One sub-package per store (`postgres/`, `mongo/`, `redis/`,
  `metrics/` for the Mongo time-series sink specifically), each exposing typed methods,
  never a raw client leaking upward.
- **`domain/`** (`src/domain/`) — pure business logic, zero I/O: the work-item state
  machine (`domain/state/`), alert severity/channel policy (`domain/alerting/`), and
  RCA completeness validation plus MTTR calculation (`domain/rca/`).

`domain/` is isolated from I/O for one reason: it's where the rules that must never be
silently bypassed live — "CLOSED requires a complete RCA," "a transition must follow
OPEN → INVESTIGATING → RESOLVED → CLOSED," "an RDBMS failure is never alerted below
P0." If those rules were expressed as conditionals scattered across route handlers, a
second caller (a worker, a future CLI, a bulk-import script) could reach CLOSED without
ever passing through the check. Because domain code takes no dependency on Express,
Prisma, ioredis, or BullMQ, it can be exhaustively unit-tested — every transition,
every malformed RCA, every alert strategy — without a running database, and the same
domain object is reused by every caller instead of being re-implemented per entry
point. It's also what makes the State and Strategy patterns practical (full mechanics
and an extension walkthrough: [design-patterns.md](design-patterns.md)): both are plain
objects implementing an interface, defined once in `domain/`, and swapping or extending
one doesn't touch a route, a Prisma call, or a worker.

**One deliberate exception worth naming:** the debounce *decision* (does this signal
belong to an existing work item, or does a new one need creating) is not domain code —
it lives in `SignalDebouncer` (`src/services/ingestion/debouncer.ts`), a service. The
decision is inseparable from a live check against Redis (a cached session) and,
on a miss, Postgres (the actual row) — see
[design-patterns.md's note on why debouncing isn't a domain-layer pattern](design-patterns.md#a-note-on-debouncing)
and [ADR 0010](decisions/0010-redis-fast-path-with-postgres-backstop-for-debouncing.md)
for the full reasoning. The correctness guarantee it relies on (`idx_work_items_active_component_id`,
a Postgres partial unique index) *is* enforced by the database, not by this service's
own logic — see [data-model.md](data-model.md#postgresql--source-of-truth).

## Component inventory

Every piece the assignment names, and where it lives:

| Concern | Lives in | Pattern/mechanism |
|---|---|---|
| Signal ingestion (HTTP) | `src/api/routes/signals.ts` | Express route, zod validation |
| Rate limiting | `src/rateLimit/tokenBucket.ts` | Redis-backed token bucket, per-IP + global |
| In-memory buffer | `src/services/ingestion/buffer.ts` | Four fixed-capacity ring buffers — see [backpressure.md](backpressure.md) |
| Debouncing | `src/services/ingestion/debouncer.ts` | Redis fast path + Postgres constraint — see [ADR 0010](decisions/0010-redis-fast-path-with-postgres-backstop-for-debouncing.md) |
| Async queue | `src/workers/queue.ts`, `bullMqSink.ts` | BullMQ, backed by Redis — see [ADR 0003](decisions/0003-bullmq-for-async-queue.md) |
| Batch processing (debounce → persist → cache → alert) | `src/workers/processBatch.ts`, `signalWorker.ts` | BullMQ consumer |
| Raw signal audit log | `src/repositories/mongo/signalRepository.ts` | MongoDB `signals` collection — see [data-model.md](data-model.md#mongodb--raw-signal-audit-log) |
| Work item / RCA source of truth | `src/repositories/postgres/workItemRepository.ts` | PostgreSQL, transactional — see [data-model.md](data-model.md#postgresql--source-of-truth) |
| Dashboard hot-path cache | `src/repositories/redis/dashboardCache.ts`, `services/dashboard/dashboardProjection.ts` | Redis, cache-aside on miss — see [data-model.md](data-model.md#redis--dashboard-hot-path-cache) |
| Aggregation sink | `src/repositories/metrics/metricsRepository.ts`, `services/aggregation/` | MongoDB native time-series collections — see [data-model.md](data-model.md#mongodb--aggregation-sink-time-series-collections) |
| Work item state machine | `src/domain/state/` | State pattern — see [design-patterns.md](design-patterns.md#state--work-item-lifecycle) |
| Alert severity/channel policy | `src/domain/alerting/` | Strategy pattern — see [design-patterns.md](design-patterns.md#strategy--alert-severitychannel-selection) |
| Alert delivery, dedup, escalation | `src/services/alerting/` | See [alerting.md](alerting.md) |
| RCA validation + MTTR | `src/domain/rca/` | Pure functions, zero I/O |
| Real-time push | `src/services/realtime/`, `api/routes/incidentStream.ts` | SSE over Redis pub/sub — see [ADR 0007](decisions/0007-sse-for-real-time-transport.md) |
| Optimistic concurrency on state transitions | `src/repositories/postgres/workItemRepository.ts`'s `applyGuardedTransition` | Guarded `UPDATE ... WHERE state = fromState` — see [ADR 0011](decisions/0011-optimistic-concurrency-for-state-transitions.md) |
| Observability | `src/api/routes/{health,ready,metrics}.ts`, `src/utils/metrics.ts` | See [observability.md](observability.md) |

## Three-store split

| Store | Holds | Why not the others |
|---|---|---|
| **PostgreSQL** (`work_items`, `rca_records`, `state_transitions`) | The source of truth: work item lifecycle, RCA records, the transition audit trail. | Needs real multi-row ACID transactions (a state transition and its audit row must commit together) and referential integrity (RCA is 1:1 with its work item). Mongo/Redis don't give this as ergonomically — see [ADR 0001](decisions/0001-postgres-for-source-of-truth.md). |
| **MongoDB** — two distinct roles on the same instance | (1) The raw, high-volume signal audit log (`signals` collection) — arbitrary payload shape, one document per signal. (2) The aggregation sink — five native time-series collections for throughput/volume/MTTR/alert-dispatch trends. | Schemaless and cheap to write at burst volume; putting the audit log in Postgres would couple burst-write throughput to the transactional store — the exact coupling backpressure handling exists to avoid. Time-series collections are a genuinely different storage layout from the audit log, not just "reusing Mongo for convenience" — see [ADR 0002](decisions/0002-mongodb-for-signal-audit-log.md) and [ADR 0005](decisions/0005-mongodb-timeseries-for-aggregation.md). |
| **Redis** — three distinct roles on one instance | Dashboard hot-path state (active-incident list, per-incident summary), the BullMQ queue's backing store, and the rate limiter's token-bucket state. | Sub-millisecond reads for a UI that refreshes constantly, and the one store genuinely shared across replicas (see [backpressure.md's cross-replica note](backpressure.md#what-this-doesnt-handle-by-design)). Postgres could serve the dashboard reads too, but at a cost this system doesn't need to pay on every poll. |

Between them, Postgres and the two Mongo roles answer the assignment's four storage
requirements directly: data lake (Mongo/signals), source of truth (Postgres),
aggregations (Mongo/time-series). The fourth — the cache — is Redis, covered above.

## Write path vs. read path

**Write path:** a signal source posts to the ingestion API, which validates the
payload, checks it against the rate limiter (Redis token bucket — rejected requests
never reach the buffer), and hands accepted signals to the in-memory buffer, acking the
caller with `202` before anything durable happens. An interval timer drains the buffer
in strict priority order and hands each batch to `BullMqSignalSink`, which enqueues one
BullMQ job per batch (`src/workers/bullMqSink.ts`). A worker (`signalWorker.ts`)
dequeues the job and runs `processBatch.ts`: resolve each signal's debounce session
(a session hit links to an existing work item; a miss creates one, guarded by the
Postgres partial unique index against a concurrent creator), bulk-insert the raw
documents into Mongo (`insertManyIdempotent` — safe against a BullMQ retry redelivering
the same job), apply the resulting signal-count increments to Postgres inside a
transaction, write through the Redis dashboard cache, dispatch an alert if any work
item was newly created, and write aggregation points to the Mongo time-series
collections. State transitions and RCA submission (`POST /:id/transition`,
`POST /:id/rca`) are the one other write path, entering directly through
`WorkflowService` rather than the buffer/queue, since they're operator-initiated and
low-volume rather than high-throughput signal ingestion — each still runs inside a
Postgres transaction and still write-throughs the cache and dispatches an alert on
every transition, not just creation.

**Read path:** the dashboard's Live Feed reads Redis's active-incident sorted set
directly — no Postgres round trip on refresh. Incident Detail reads Redis for the
cached summary and Mongo for the linked raw signals. Analytics reads the Mongo
time-series collections through server-side aggregation pipelines. On a cache miss
(cold start, TTL expiry, a Redis flush or outage), the read falls back to Postgres and
repopulates Redis (cache-aside) rather than the dashboard ever querying Postgres on the
common path — and if Redis is genuinely unreachable rather than merely cold, the
projection service distinguishes the two and serves Postgres directly instead of
mistaking "unreachable" for "empty" (see
[backpressure.md's chaos-test section](backpressure.md#measured-under-the-chaos-suite)
for the test that forced this distinction to be made explicit).

The two paths only meet at the stores themselves — nothing on the read side blocks on
or waits for the write side, which is what lets ingestion keep accepting signals even
if a worker, Mongo, or Postgres is momentarily behind, and lets the dashboard keep
serving reads even if the write path is fully stalled.

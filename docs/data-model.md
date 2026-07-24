# Data Model

How the same incident data is shaped in each store, and why. See
[architecture.md](architecture.md) for the three-store split rationale and
[backpressure.md](backpressure.md) for the ingestion buffer this sits
downstream of.

## PostgreSQL — source of truth

`work_items`, `rca_records`, `state_transitions`. Full column/index detail
lives in `prisma/schema.prisma` and the migrations; not duplicated here
since the schema itself is the authoritative source. The two things worth
calling out that aren't obvious from the schema alone:

- `idx_work_items_active_component_id` (partial unique index on
  `component_id` `WHERE state != 'CLOSED'`) is what actually guarantees at
  most one active work item per component — see
  `src/services/ingestion/debouncer.ts`.
- `signal_count` starts at 0 and is incremented by exactly 1 per signal
  durably persisted to Mongo, uniformly, including the signal that
  triggered creation — see `src/workers/processBatch.ts`'s comment for why.

## MongoDB — raw signal audit log

One document per signal in the `signals` collection
(`src/repositories/mongo/signalRepository.ts`):

```ts
{
  signalId: string,       // unique — the idempotency key end to end
  componentId: string,
  componentType: string,
  severity: string,
  rawPayload: unknown,    // arbitrary, as received
  occurredAt: Date,       // client-reported
  receivedAt: Date,       // server-assigned, source of truth for firstSignalAt
  workItemId: string | null,
}
```

Indexes (`MongoSignalRepository.ensureIndexes()`, called once at worker
startup): unique on `signalId`, plain on `workItemId` (the incident-detail
signal listing and per-work-item counts both filter by it).

## Redis — dashboard hot-path cache

Populated write-through by the worker (`src/workers/processBatch.ts`) and
the workflow service (`src/services/workitems/workflowService.ts`) on
every mutation that touches a work item's cache-visible fields — never on
a timer, never lazily on the write side. Read-side cache misses (cold
start, an evicted TTL, a Redis flush) are repopulated from Postgres
on-demand by `src/services/dashboard/dashboardProjection.ts`, so a cold
cache degrades to "one extra Postgres read," never an error.

| Key | Type | Contents | TTL |
|---|---|---|---|
| `dashboard:active_incidents` | ZSET | member = `workItemId`, score = `severityRank * 1e13 + firstSignalAtMs` | none — see below |
| `dashboard:incident:<id>` | STRING (JSON) | `IncidentSummary` (id, componentId, componentType, severity, state, title, firstSignalAt, signalCount, updatedAt) | `DASHBOARD_CACHE_TTL_SECONDS` (default 1h) |

**Score encoding.** Severity dominates (P0 < P1 < P2 < P3 numerically,
0–3), `firstSignalAt` (epoch ms) breaks ties within a severity — `1e13` is
comfortably larger than any realistic epoch-ms value, so severity always
wins the comparison regardless of how old or recent the tied entries are.
This reproduces `PostgresWorkItemRepository.listActive`'s
`ORDER BY severity, first_signal_at` using a single Redis `ZRANGE`, no
sort needed at read time.

**Why the ZSET has no TTL and the per-incident hash does.** The ZSET is
the *list* of what's active — it's kept correct exclusively by explicit
`ZADD`/`ZREM` calls on every mutation (including removal on CLOSE), so a
TTL on the whole key would be actively wrong: it would eventually wipe out
incidents that are still genuinely active, not just clean up stale data.
The per-incident hash is a point cache for one row's detail; a TTL there
is a pure safety net in case a write-through was ever missed (a bug, a
crash mid-operation) — the entry self-heals via the next cache-miss
repopulation rather than serving stale data forever. It is deliberately
*not* the primary invalidation mechanism: every real mutation path calls
`upsertActiveIncident`/`removeIncident` synchronously as part of the same
operation that changed Postgres, so under normal operation the TTL should
essentially never be the reason an entry disappears.

**Cold-cache / partial-cache recovery.** `dashboardProjection.ts`
distinguishes "empty because there really are zero active incidents" from
"empty because the cache was never populated" the same way for both the
list and a single entry: if the read comes back empty/missing, it queries
Postgres directly, repopulates whatever it finds via the same
write-through path the mutation side uses, and re-serves from the
now-populated (or genuinely-empty) cache. This bounds recovery to one
extra Postgres round trip on a miss, capped at a configurable page size
for the list-repopulation case — see that file's comments for the exact
cap and its limitation for a pathologically large active set.

## MongoDB — aggregation sink (time-series collections)

Backs assignment section 2B ("Sink (Aggregations): Support timeseries
aggregations"). Deliberately a *second* role for the same MongoDB instance
already used as the raw signal audit log, not a new engine — see the chat
proposal that preceded this implementation for the full comparison against
Redis TimeSeries / TimescaleDB / a dedicated store (InfluxDB/Prometheus)
and why native time-series collections won for this project's scope.
Implementation: `src/repositories/metrics/metricsRepository.ts` (write +
query), `src/services/aggregation/` (batched, drop-on-failure write path
and the read-side query service), `src/api/routes/analytics.ts` (the
query API).

Five native time-series collections (`timeField: "ts"`, `metaField: "dims"`),
provisioned idempotently by `MongoMetricsRepository.ensureCollections()`
at worker startup, same posture as `MongoSignalRepository.ensureIndexes()`:

| Collection | dims | value field(s) | written from | retention |
|---|---|---|---|---|
| `signal_volume_metrics` | `componentId`, `severity` | `count` | worker (`processBatch.ts`), batched per tick | 30 days |
| `workitem_created_metrics` | `componentType`, `severity` | `count` (always 1) | worker (`processBatch.ts`), batched per tick | 90 days |
| `state_transition_metrics` | `fromState`, `toState` | `count` (always 1), `timeInStateMs` | `WorkflowService`, per transition | 30 days |
| `mttr_metrics` | `componentType`, `severity`, `componentId` | `mttrMs` | `WorkflowService.submitIncidentRca`, per closed incident | 90 days |
| `alert_dispatch_metrics` | `channel`, `outcome` (`delivered`\|`failed`) | `count` (always 1) | `AlertDispatcher`, per channel per delivery attempt | 30 days |

**Retention policy.** Enforced via each collection's native
`expireAfterSeconds`, set at creation — no separate cleanup job. High
write-volume, short-lived-value series (raw signal throughput, every state
transition, every alert delivery attempt) get 30 days; lower-volume,
longer-value series (one row per work item created or closed) get 90 days
for a meaningful longer trend line. Hardcoded as named constants in
`metricsRepository.ts` rather than exposed as env vars, unlike most of this
project's other tunables — retention here is a fixed policy decision, not
an operational knob comparable to buffer sizing or queue concurrency.

**Write granularity: pre-aggregated at write time, bucketed further at
query time.** The worker doesn't write one document per raw signal — it
groups a processed batch by `(componentId, severity)` and writes one point
per group with that batch's count (see `processBatch.ts`'s
`buildSignalVolumePoints`). Query-time `$group`/`$dateTrunc` bucketing sums
these correctly regardless of write-side granularity, and this keeps write
volume proportional to distinct dimensions per tick, not signal count.

**Write path never blocks or fails signal persistence.**
`services/aggregation/metricsWriter.ts`'s `MetricsWriter` wraps every write
in a try/catch: a failure is logged and the point is dropped, not retried
— an indefinite retry loop here is exactly what could turn a metrics-store
hiccup into back-pressure on the signal-persistence path it's called
from. `AlertDispatcher`'s dependency on this is a *provider function*
(`() => MetricsWriter`), not a direct instance — `AlertDispatcher` is
constructed eagerly at module load (`alertingInstance.ts`), before
`connectClients()` has run, while the real `MetricsWriter` needs a live
Mongo connection; deferring resolution to first dispatch sidesteps that
ordering problem.

**Query API pushes every bucket into the aggregation pipeline** — no route
handler or service pulls raw metric documents into Node and sums/averages
them there. `$dateTrunc` buckets by time; `$setWindowFields` computes the
MTTR trend's rolling average (a trailing window over the last 5 per-bucket
averages) server-side. `GET /api/v1/analytics/components/:id` is the one
endpoint that composes across stores: recent signal volume and average MTTR
from this Mongo aggregation layer, current open-item counts by state from a
Postgres `GROUP BY` (`PostgresWorkItemRepository.countByComponentIdGroupedByState`)
— each half is still a real aggregate query pushed to its own store, just
composed at the service layer rather than sourced from one place.

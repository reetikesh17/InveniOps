# 0005 — MongoDB native time-series collections for the aggregation sink

**Status:** Accepted

## Context

The assignment's section 2B requires a fourth, distinct sink purpose-built
for timeseries aggregations — separate from the data lake (raw signal audit
log), the source of truth (work items/RCA), and the hot-path cache. It needs
to answer: signal volume bucketed per minute by componentId/severity, work
items created by componentType/severity, state-transition counts and
time-in-state, MTTR per closed incident plus a rolling aggregate, and alert
dispatch counts by channel/outcome — all bucketed server-side, with a
retention policy, inside a one-week project's infra budget and `CLAUDE.md`'s
"stack locked — do not substitute" constraint.

## Decision

Native MongoDB time-series collections (`timeField`/`metaField`, available
since MongoDB 5.0; this project runs `mongo:7`) — a second role for the same
MongoDB instance already provisioned as the raw signal audit log, not a new
engine. Five collections
(`src/repositories/metrics/metricsRepository.ts`), each with retention via
native `expireAfterSeconds`. Writes are pre-aggregated by the caller (grouped
by dimension per batch/event, not one document per raw signal); reads bucket
further via the aggregation pipeline (`$group`/`$dateTrunc` for time
buckets, `$setWindowFields` for the MTTR rolling average) — nothing is
pulled into Node and summed there. Full design: [docs/data-model.md](../data-model.md) (see "MongoDB —
aggregation sink").

## Consequences

- Zero new infrastructure — respects "stack locked," and a time-series
  collection is a genuinely different storage layout (bucketed, columnar-ish)
  from the raw signal collection, which is a real answer to the rubric's
  "correct separation of data for various purpose," not just reusing Mongo
  for convenience.
- The aggregation pipeline (`$group`, `$dateTrunc`, `$setWindowFields`)
  covers every requested query without pulling raw points into application
  code.
- No continuous/materialized downsampling — retention is TTL-only. Fine at
  this project's data volume and one-week retention horizon; would need
  revisiting at real scale (see below).
- `mttr_metrics` carries `componentId` as an extra dimension beyond the
  spec's stated `componentType`/`severity`, specifically so
  `GET /analytics/components/:id` can filter server-side instead of pulling
  records into Node to average them.

**At real production scale**, I'd move to TimescaleDB for continuous
aggregates and native downsampling (or a dedicated Prometheus/VictoriaMetrics
stack, if these were pure infra metrics rather than business metrics needing
joins back to relational work-item data), and likely add Redis TimeSeries
as a complement — not a replacement — for a last-N-minutes hot window
powering a live dashboard sparkline, where sub-ms reads matter more than
query flexibility.

## Alternatives considered

- **Redis TimeSeries module.** Rejected — the `redis:7-alpine` image in
  `docker-compose.yml` has no modules loaded; using it means either an image
  substitution (`redis/redis-stack`, in tension with "stack locked") or
  installing the module, plus no typed `ioredis` API (raw `TS.*` commands
  only). Also weak for genuine multi-dimensional group-bys (componentId
  *and* severity together) — that's a labels-per-key model, closer to
  Prometheus, needing either fan-out keys or client-side merging. Best
  native retention/downsampling of the four options, and the best fit for a
  small last-N-minutes hot window specifically — hence "complement, not
  replacement" above.
- **TimescaleDB (Postgres extension).** Rejected for this project's scope —
  needs a `timescaledb` image swap or manual extension install not present
  in the locked `postgres:16` image; Prisma has no native hypertable
  support, so hypertable/continuous-aggregate DDL would live outside
  `schema.prisma` as raw SQL; and it loads the already-write-heavy
  transactional source-of-truth instance with aggregation write volume.
  Technically the strongest option (full SQL, `time_bucket()`, continuous
  aggregates with native downsampling) — the pick at real scale, see above.
- **A dedicated store (InfluxDB, Prometheus).** Rejected — a wholly new
  service in `docker-compose.yml`, a new client library, a new query
  language, for a one-week project already respecting a locked stack.
  Prometheus is additionally a pull/scrape model, an awkward fit for a
  push-based, worker-batched write path.

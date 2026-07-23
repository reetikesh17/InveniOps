# 0002 — MongoDB for the raw signal audit log

**Status:** Accepted

## Context

Signals arrive in bursts of up to 10,000/sec, each with a raw payload shape defined by
its producer (an API error body, an MCP host trace, a cache eviction event, etc.) —
there's no single fixed schema across sources. Every signal must be retained as an
audit record, linked to whichever work item it debounces into, and be queryable both
"all signals for this work item" and "signals for this component in a time range" —
without adding load to the transactional store handling work-item writes.

## Decision

MongoDB 7 holds the `signals` collection. Each document carries an app-assigned
`signalId` (a UUID generated at ingestion, before the write happens — necessary because
the ingestion API acks the caller before persistence completes), an unconstrained
`rawPayload`, and a `workItemId` that starts `null` and is set once the debouncer
assigns the signal to a work item.

## Consequences

- No migration is needed when a new signal producer sends a differently-shaped
  payload — the collection has no fixed schema to alter.
- Append-heavy, high-throughput writes don't contend with Postgres's transactional
  workload, which is the point: a slow or backed-up signal store must not be able to
  slow down work-item state transitions, or vice versa.
- Cross-store referential integrity is lost — a `workItemId` pointing at a deleted
  work item isn't caught by a database constraint; this has to be handled in
  application code if it ever matters.
- One more store to connect to, retry against, and keep healthy in local dev and
  production alike.

## Alternatives considered

- **Postgres JSONB column** on a `signals` table. Rejected — would put burst-write
  load on the same instance handling transactional work-item writes, exactly the
  coupling backpressure handling is meant to avoid.
- **Flat files / object storage** (S3-style) per signal. Rejected — unqueryable
  without building a secondary index, which is the wrong tool for "time-range queries
  per component."
- **A dedicated time-series database** (TimescaleDB, InfluxDB). Rejected as an extra
  infrastructure dependency beyond what the stack calls for, and signals aren't purely
  numeric time-series data — the payload is arbitrary JSON, not a metric.

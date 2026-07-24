# Observability

Everything needed to answer "is this healthy," "is this ready for traffic,"
"what's it doing right now," and "what happened to this one signal" —
without ever blocking a request on a live dependency call. Implementation:
`src/utils/healthProbe.ts`, `src/services/observability/`,
`src/api/routes/{health,ready,metrics}.ts`, `src/utils/metrics.ts`.

## Endpoints

### `GET /health` — liveness

```json
{
  "status": "healthy",
  "uptimeSeconds": 1234.5,
  "version": "0.1.0",
  "dependencies": {
    "postgres": { "status": "up", "latencyMs": 3 },
    "mongo":    { "status": "up", "latencyMs": 2 },
    "redis":    { "status": "up", "latencyMs": 1 },
    "queue":    { "status": "up", "latencyMs": 1 }
  },
  "buffer": { "depth": 0, "capacity": 20000, "fillFraction": 0, "shedding": false },
  "queue":  { "waitingCount": 0, "activeCount": 0, "dlqSize": 0 },
  "throughput": { "signalsPerSecond": 0 }
}
```

`status` is `unhealthy` (**HTTP 503**) if any of postgres/mongo/redis/queue
is down; `degraded` (HTTP 200) if all four are up but the buffer is
currently shedding — shedding isn't a dependency outage, the service is
still serving traffic (P0 still gets through), so it stays in a load
balancer's rotation; `healthy` (HTTP 200) otherwise. `dependencies`, `buffer`
(depth/fill/shedding), and `queue` (depth/DLQ) are read from an in-memory
cache refreshed in the background — this handler performs **zero I/O**, so
it can't be slow even if a dependency is hanging. See
[Caching and timeouts](#caching-and-timeouts) below.

### `GET /ready` — readiness

```json
{ "ready": true, "checks": { "bufferDraining": true, "workerRunning": true } }
```

**HTTP 200** once both the ingestion buffer's drain loop and the BullMQ
worker are actually running; **503** otherwise. Deliberately distinct from
`/health`: dependencies can be fully reachable (liveness green) before the
worker has started consuming — routing ingestion traffic in that window
would accept signals nothing is processing yet. A failing readiness probe
tells a load balancer to hold traffic without restarting the instance; a
failing liveness probe is the signal to kill and restart it. Both checks are
synchronous, in-memory reads — same non-blocking posture as `/health`.

### `GET /metrics` — Prometheus scrape target

`200 text/plain; version=0.0.4`. Hand-rolled exposition format (no
`prom-client` dependency — see
[docs/decisions/0005-mongodb-timeseries-for-aggregation.md](decisions/0005-mongodb-timeseries-for-aggregation.md)
for the broader reasoning on not adding metrics-library dependencies this
project doesn't need). Every counter here is **cumulative since process
start** — Prometheus computes rates itself from repeated scrapes; nothing on
this endpoint resets on read, unlike the console line below. See the
[metrics catalog](#metrics-catalog).

## Caching and timeouts

`/health`'s dependency checks and queue-depth numbers come from
`CachedProbe<T>` (`utils/healthProbe.ts`): a background loop refreshes a
snapshot every `HEALTH_PROBE_INTERVAL_MS` (default 5s), each individual
probe bounded by `HEALTH_PROBE_TIMEOUT_MS` (default 2s) via `Promise.race`.
The route handler only ever reads the cached snapshot — never makes a live
call — so a hung Postgres connection makes that dependency read `"down"`
after its own timeout elapses on the *background* tick, but never delays an
actual `/health` response. `/metrics` reuses the same cached queue-depth
probe (consistent numbers between the two endpoints, one fewer live-I/O path)
and additionally runs one live, indexed Postgres `GROUP BY` per scrape for
work-item-by-state counts — cheap enough at typical scrape intervals
(15–30s) that it doesn't need the same caching treatment.

## Metrics catalog

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `ims_signals_received_total` | counter | `severity` | Signals that passed validation at the ingestion endpoint, regardless of accept/shed outcome |
| `ims_signals_accepted_total` | counter | `severity` | Signals that made it into the in-memory buffer |
| `ims_signals_dropped_total` | counter | `severity`, `reason` | Signals never buffered — `reason` is `shed_ceiling` (graceful, severity-aware), `hard_capacity`, or `sink_failure` (see [Backpressure Handling](../README.md#backpressure-handling)) |
| `ims_buffer_depth` | gauge | `severity` | Current signals sitting in the buffer, per severity lane |
| `ims_buffer_fill_ratio` | gauge | — | Current `totalSize / capacity`, 0–1 |
| `ims_queue_depth` | gauge | `state` (`waiting`\|`active`) | Current BullMQ job counts |
| `ims_queue_dlq_size` | gauge | — | Current dead-letter queue size — jobs that exhausted every retry |
| `ims_queue_jobs_total` | counter | `outcome` (`processed`\|`failed`) | Cumulative BullMQ batch jobs |
| `ims_work_items` | gauge | `state` | Current work item count per lifecycle state (always emits all four, even at zero) |
| `ims_alerts_total` | counter | `channel`, `outcome` (`delivered`\|`failed`) | Cumulative alert delivery attempts per channel |
| `ims_escalations_triggered_total` | counter | — | Cumulative escalations fired |
| `ims_signal_e2e_latency_ms` | histogram | `le` (buckets) | Time from signal receipt (`receivedAt`) to the worker finishing that batch — buckets at 10/25/50/100/250/500/1000/2500/5000/10000ms |

## Reading the console line

Every 5 seconds (`intervalMs` in `startMetricsReporter`), one plain line
goes straight to stdout — deliberately **not** through the structured JSON
logger, so it stays glanceable in a terminal instead of a wall of JSON:

```
[metrics] 14:32:05Z | 842.0/s | buffer 12.3% | queue depth 3 | active items 47 | drops 0 | p50 38ms p99 210ms
```

| Field | Meaning |
|---|---|
| `14:32:05Z` | UTC time of this tick |
| `842.0/s` | Signals accepted per second over the last interval |
| `buffer 12.3%` | Ingestion buffer fill fraction right now |
| `queue depth 3` | BullMQ waiting + active jobs right now |
| `active items 47` | Non-CLOSED work item count (`PostgresWorkItemRepository.countActive()`) |
| `drops 0` | Signals dropped (any reason) **since the last tick**, not cumulative — for the cumulative, per-reason breakdown, use `/metrics` |
| `p50 38ms p99 210ms` | End-to-end (receipt → persisted) latency percentiles over jobs completed in this interval |

`n/a` appears for `active items`/`p50`/`p99` if that particular read failed
or nothing completed in the window — the line still prints; a bad read
never crashes or skips the tick.

## Tracing one signal end to end

Every signal has two identifiers with different scopes:

- **`signalId`** — assigned at ingestion (or supplied by the source),
  persisted with the signal in Mongo forever. The right key once you already
  know which signal you care about.
- **`correlationId`** — the *originating HTTP request's* id (`req.id`,
  `pino-http`-generated, also returned as the `x-request-id` response
  header). Every signal from the same `POST /api/v1/signals` call shares
  one. The right key to go from "a request a client made" to "everything
  that happened to it downstream."

Path: `POST /api/v1/signals` → `pino-http`'s request-completed log line
(has `req.id`) → the signal carries `correlationId` into the in-memory
buffer → the buffer-to-queue drainer serializes it into the BullMQ job
payload (`SerializedIngestionSignal.correlationId` — this is the hop that
used to lose it entirely) → the worker logs one `"batch processed"` line per
job with `jobId`, the batch's **distinct** `correlationIds`, `batchSize`,
and `latencyMs`.

That last line is deliberately *not* one log line per signal — a single
BullMQ job aggregates whatever the buffer happened to batch together
(possibly from several different HTTP requests), and one-line-per-signal is
exactly the volume this system is designed to survive. To trace one
specific signal: find its request's completion log by `correlationId`
(or the `x-request-id` header the client received), then find the
`"batch processed"` line(s) whose `correlationIds` array contains it — that
gives the `jobId`, batch size, and latency for the batch it was processed
in. If that job's batch ultimately failed all its retries, the same
`correlationId` shows up in the DLQ's forwarded payload
(`DeadLetterJobData.data.signals[].correlationId`), since the DLQ entry
embeds the original job data verbatim.

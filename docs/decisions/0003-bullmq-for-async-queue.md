# 0003 — BullMQ for the async signal-processing queue

**Status:** Accepted

## Context

Ingestion has to accept a signal, buffer it, and ack the caller without waiting on any
persistence — the actual work (debounce, write to Mongo, create/update the work item
in Postgres, update the Redis dashboard cache) happens asynchronously and may run
slower than the accept path. That processing has to survive a slow or momentarily
unavailable store without dropping signals or blocking the ingestion API, which means
something durable has to sit between "signal buffered" and "signal processed."

## Decision

BullMQ, backed by the Redis instance already provisioned for the dashboard cache, is
the async processing queue between the ingestion buffer and the signal workers.

## Consequences

- Reuses infrastructure already in the stack instead of adding a new broker to run,
  configure, and monitor.
- Retry, exponential backoff, delayed jobs, and job-status inspection come built in
  rather than needing to be hand-rolled.
- Queue durability is tied to Redis's own persistence settings (AOF is enabled — see
  `docker-compose.yml`) rather than to a broker with its own durable commit log.
- Queue throughput is bounded by a single Redis instance unless later sharded or
  clustered — an acceptable limit at this project's scale, worth revisiting if signal
  volume outgrows one node.

## Alternatives considered

- **RabbitMQ.** Rejected — a capable broker, but a second piece of infrastructure to
  run and monitor for a single-node exercise, with no capability this system needs
  that BullMQ-on-Redis lacks.
- **Raw Redis lists/streams, hand-rolled.** Rejected — would mean reimplementing
  retry, backoff, and dead-letter handling that BullMQ already provides.
- **Kafka.** Rejected — built for durable-log/replay and multi-consumer-group fan-out
  this system doesn't need; heavyweight for the scale and scope here.

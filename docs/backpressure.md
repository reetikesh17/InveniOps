# Backpressure Handling

`src/services/ingestion/buffer.ts` sits between the ingestion HTTP handler
(`POST /api/v1/signals`) and everything downstream. It's the piece that
answers the assignment's core constraint: **the system cannot OOM or fall
over when the persistence layer is slow, no matter how fast signals
arrive.**

## Structure

Four fixed-capacity circular buffers, one per severity (P0–P3), each a
preallocated array with wrapping head/tail indices — O(1) push and pop, no
allocation churn at steady state. All four are preallocated at the *full*
configured capacity (`BUFFER_CAPACITY`, default 20,000), not
`capacity / 4`, because a single-severity flood (e.g. every incoming signal
is `CACHE`) is a legitimate scenario that must be handled correctly without
resizing — resizing at runtime would make memory usage a function of the
traffic pattern, which is exactly what "bounded and predictable" rules out.

The actual bound is a single shared invariant enforced one level up, in
`SignalBuffer`: **`totalSize` (the sum across all four queues) never
exceeds `BUFFER_CAPACITY`.** No combination of arrivals — one severity
alone, all four at once, anything in between — can push the buffer past
that number. Peak resident memory is therefore a fixed, known constant
(`capacity` signal-sized slots, worst case, regardless of arrival rate),
not something that grows with request volume.

## Watermark state machine

```
fill% = totalSize / capacity

normal --[fill% >= HIGH_WATER_MARK]--> shedding
shedding --[fill% <= LOW_WATER_MARK]--> normal
```

Two marks, not one, and they're deliberately different values
(0.8 / 0.5 by default) — that gap is hysteresis. A single mark would let
the state flap open/closed on every request right at the boundary once
the buffer is hovering near it under sustained load; recomputing state
after every enqueue and every drain, against two different thresholds,
means the buffer has to visibly drain back down before shedding turns off
again, rather than toggling on a single borderline signal.

## Shedding policy: ceilings, not active eviction

This is the part worth explaining carefully, because "drop the
lowest-severity signal first" has more than one reasonable implementation,
and the obvious one doesn't actually work well.

**Rejected: active cross-queue eviction.** The tempting design is: when a
higher-severity signal arrives and the buffer is full, actively evict the
oldest item from whatever's the lowest non-empty severity queue to make
room. This only works cleanly against a *single shared* capacity check —
which is exactly what's used here — but it means *every* per-severity
queue must be able to grow to the full shared capacity in the normal case
(a legitimate single-severity flood), so there's no smaller "ceiling" to
lean on structurally; the eviction logic has to run on the hot path for
every arrival once the buffer is under any pressure at all, actively
reaching across queues on every single request. It works, but it's more
moving parts than the alternative below for no real benefit.

**What's implemented instead: per-severity ceilings, applied only while
shedding.** Below the high-water mark, there's no ceiling — any severity
can grow to the full shared capacity, so a single-severity flood is
handled correctly. Once shedding engages, each *non-P0* severity is
additionally capped at a fraction of total capacity:

| Severity | Ceiling fraction (default) | Slots at capacity 20,000 |
|---|---|---|
| P0 | none (uncapped, up to the hard limit) | up to 20,000 |
| P1 | 0.7 (`BUFFER_SHED_CEILING_P1_FRACTION`) | 14,000 |
| P2 | 0.4 (`BUFFER_SHED_CEILING_P2_FRACTION`) | 8,000 |
| P3 | 0.15 (`BUFFER_SHED_CEILING_P3_FRACTION`) | 3,000 |

Because P3's ceiling is smallest, its queue reaches its limit and starts
being rejected *first* under sustained mixed-severity load — well before
P2's larger ceiling, which is in turn well before P1's. "Drop the
lowest-severity signal first" falls directly out of the shape of these
numbers, not out of an eviction algorithm: each severity's own queue
simply runs out of its reserved room in priority order. The check itself
is one array lookup and one comparison — no scanning other queues, no
cross-queue mutation, on the hot synchronous `submit()` path.

**P0 and the hard limit.** P0 is exempt from ceiling shedding entirely —
the check that applies ceilings explicitly skips it. The *only* way a P0
signal is ever dropped is the separate, absolute hard-capacity path: if
`totalSize` is already at `capacity` and a P0 arrives, the buffer evicts
the oldest item from the lowest-severity *non-empty* queue (P3 first, then
P2, then P1) to make room. P0 itself is only ever the victim of that
eviction if it's the *only* thing left in the buffer — i.e., P1/P2/P3 are
all empty and 20,000 consecutive P0 signals are sitting there unconsumed.
That's a pathological scenario (either the drain loop has stopped
entirely, or something upstream is mislabeling routine traffic as P0), and
it's logged at `error` level and counted separately
(`droppedByReason.hard_capacity`) rather than silently folded in with
ordinary ceiling drops — "never drop P0" is honored as designed intent up
to the point where the alternative is an unbounded buffer, and the one
remaining edge case is loud, not silent.

## Why these numbers

- **Capacity 20,000.** The assignment specifies bursts up to 10,000
  signals/sec. 20,000 gives roughly two seconds of full-rate absorption
  before the high-water mark is even reached — enough to ride out a
  momentary stall in the drain loop or a slow sink without shedding
  anything, while still being small enough (a few tens of MB even with
  non-trivial `rawPayload`s) that "bounded" doesn't require a footnote.
- **High-water 0.8 / low-water 0.5.** Shedding engages with 20% headroom
  still in hand — the buffer never has to slam from "accepting everything"
  to "rejecting most things" at the last possible slot. Recovery requires
  draining back to half-full, not just below 80% again, so a drain loop
  that's barely keeping pace doesn't flap the state every few signals.
- **Ceilings 0.7 / 0.4 / 0.15.** Chosen so each severity has meaningfully
  less room than the one above it (P3 gets roughly a fifth of what P1
  gets), while P1 still keeps substantial headroom (70%) since it's
  presumably still worth persisting promptly. These are the most
  arbitrary numbers in this design and the most likely to need tuning
  against real traffic shape — that's why they're three independent env
  vars, not a hardcoded curve.
- **Drain batch 200 / interval 50ms.** Up to 4,000 signals/sec of drain
  throughput at default settings — comfortably above what a stub sink
  needs and a reasonable starting point for whatever the real sink (a
  BullMQ producer) turns out to cost per batch.

## Consumer: priority-ordered batch draining

An interval timer (`unref()`'d, same pattern as the throughput reporter)
fires every `BUFFER_DRAIN_INTERVAL_MS`, pops up to `BUFFER_DRAIN_BATCH_SIZE`
items in strict priority order — every available P0 first, then P1, then
P2, then P3, up to the batch cap — and hands the batch to an injected
`SignalSink`:

```ts
export interface SignalSink {
  drain(batch: readonly IngestionSignal[]): Promise<void>;
}
```

**The sink is a stub today** (`noopSignalSink`), not a BullMQ producer.
BullMQ isn't a project dependency yet, and standing up a queue (adding the
package, defining the queue name/options, wiring a connection) is its own
scoped piece of work — folding it into the buffer would mean this file's
diff was answering two different questions at once. The buffer is written
against the `SignalSink` interface specifically so that swapping in a real
BullMQ producer later touches exactly one call site
(`signalBufferInstance.ts`) and nothing about the buffer's own logic,
tests, or the HTTP contract changes.

If a tick overlaps a still-running drain (a slow sink), the tick is
skipped rather than starting a second concurrent drain — `draining` is a
simple boolean guard, not a queue of pending ticks, so a stalled sink
doesn't build up parallel in-flight drains.

**Sink failures drop the batch.** If `sink.drain()` throws, every signal
in that batch is counted under `droppedByReason.sink_failure` and logged,
not re-queued. Re-enqueuing on failure was considered and rejected here:
doing it safely needs its own bounded-retry-with-backoff design (to avoid
either an infinite loop on a permanently broken sink, or silently
re-ordering signals around the priority queues), and that's exactly the
kind of resilience a real BullMQ consumer already provides out of the box
downstream. Building a second, buffer-level retry mechanism on top of a
stub sink would be solving a problem the real sink will already solve
differently.

## Graceful shutdown

`SignalBuffer.drainAll(timeoutMs)` repeatedly drains full-speed batches —
ignoring the normal interval — until the buffer is empty or the timeout
elapses, then reports what's left behind. Wired into the existing shutdown
hook in `src/index.ts`, ahead of closing the Postgres/Mongo/Redis clients:

```
SIGTERM/SIGINT → stop accepting new HTTP connections is not this file's job (index.ts's server.close is)
                → signalBuffer.stop()            (stop the interval)
                → signalBuffer.drainAll(10_000)   (BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS)
                → disconnect Postgres/Mongo/Redis
```

Given a large enough timeout relative to the buffer's depth and drain
rate, nothing in flight at shutdown time is lost — proven directly in
`tests/unit/services/ingestion/buffer.test.ts` ("drainAll (shutdown) →
loses nothing when given adequate time").

## Observability — nothing dropped silently

`SignalBuffer.getStats()` returns depth per severity, fill fraction,
current state, and drop counts both by severity and by reason
(`shed_ceiling` / `hard_capacity` / `sink_failure`). It's pulled (not
pushed) from two places:

- **The 5-second console report** (`utils/metrics.ts`) — `startMetricsReporter`
  takes an optional `getBufferStats` callback and includes the full stats
  object in the log line alongside `signalsPerSecond`.
- **`GET /health`** — includes the same stats under a `buffer` key.
  `/health`'s top-level `status` gains a third value, `"degraded"`
  (still HTTP 200): all dependencies up, but the buffer is currently
  shedding. Shedding isn't a dependency outage — the service is still
  serving traffic, P0 still gets through — so it shouldn't take the
  service out of a load balancer's rotation (`503` would), but it's a
  real operational signal worth surfacing.

## What this doesn't handle (by design, for now)

- **The real sink.** `noopSignalSink` is a placeholder; wiring BullMQ is
  the next piece of work, not this one.
- **Re-queuing failed batches.** Deliberately deferred to the real sink's
  own retry semantics (see above).
- **Multi-process/replica buffer state.** This buffer is in-process
  memory, per replica — by design (that's what "in-memory buffer" means
  in the assignment), but it means shedding decisions are made locally,
  per instance, not against a cluster-wide view. The token-bucket rate
  limiter (`src/rateLimit/tokenBucket.ts`) is the one thing in this system
  that *is* cross-replica, via Redis, precisely because rate limiting
  needs a shared view and buffering doesn't.

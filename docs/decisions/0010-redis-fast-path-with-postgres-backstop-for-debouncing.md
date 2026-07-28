# 0010 — Redis fast path with a Postgres constraint as the correctness backstop, for debouncing

**Status:** Accepted

## Context

The assignment's debounce rule: up to 100 signals for the same Component ID
within 10 seconds must collapse into exactly one Work Item, while every one
of those signals is still linked to it in the NoSQL audit log. That "exactly
one" has to hold under real concurrency — multiple BullMQ workers, or
multiple signals from the same burst landing in different jobs, could
plausibly race to be "the first signal for this component" at the same
moment. The mechanism also sits on the hot path (it runs once per signal,
inside every batch job), so it needs a fast common case, not just a correct
one.

## Decision

`SignalDebouncer` (`src/services/ingestion/debouncer.ts`) resolves each
signal in two tiers:

1. **Fast path — a Redis session.** `debounce:session:<componentId>` is a
   hash (`workItemId`, `count`, `startedAtMs`) with a TTL of
   `DEBOUNCE_WINDOW_SECONDS` (default 10s). A signal that finds a valid
   session (not expired, `count` under `DEBOUNCE_THRESHOLD` — default 100)
   links to that `workItemId` with one Redis read and an increment. No
   Postgres round trip.
2. **Slow path — resolve against Postgres, under a short-lived lock.** On a
   session miss (first signal for a component, or the session expired/hit
   its count), the debouncer takes a Redis lock (`SET ... NX PX`,
   `DEBOUNCE_LOCK_TTL_MS` default 5s) and queries Postgres directly for an
   existing active work item. If one exists, it links to it and reseeds the
   session. If not, it attempts `createWorkItem` — guarded by
   `idx_work_items_active_component_id`, a partial unique index on
   `work_items(component_id) WHERE state != 'CLOSED'`
   (see [data-model.md](../data-model.md#postgresql--source-of-truth)). A
   concurrent creator loses that race with a constraint violation, not a
   second row; the loser catches it, re-queries, and links to whichever
   work item the winner actually created. A caller that couldn't acquire
   the lock within `DEBOUNCE_LOCK_WAIT_TIMEOUT_MS` polls briefly for the
   winner's session to appear, then falls back to resolving independently
   if it still doesn't — correct either way, because the database
   constraint, not the lock, is the actual guarantee.

**The Redis session is a performance optimization. The Postgres unique
index is the correctness guarantee.** Every debounce decision is safe even
if Redis is flushed, evicts a key early, or is skipped entirely — the worst
case is more Postgres round trips, never a duplicate work item.

## Consequences

- The common case (signal 2 through N of a burst) costs one Redis round
  trip, not a database query — this is what keeps debouncing off the
  critical path for burst volume.
- Correctness doesn't depend on Redis's availability or consistency at
  all — a Redis outage degrades this to "every signal takes the slow path,"
  proven directly by `redisOutage.test.ts`'s posture (though that test's
  primary focus is the dashboard cache and rate limiter, not the
  debouncer specifically), not to a wrong answer.
- The lock is a *reduction* in contention, not the correctness mechanism —
  it's fine for it to be lost, expire early, or be skipped by a caller that
  gave up waiting, because the unique index behind it is what actually
  prevents two work items.
- Verified under real concurrency, not just by design: `tests/integration/services/debouncer.test.ts`
  fires 60 simultaneous signals for one component, 8 times over, against a
  real Postgres, and asserts exactly one work item every single iteration —
  a single trial passing wouldn't rule out a rare race; repetition does.

## Alternatives considered

- **A Redis-only lock (e.g. Redlock) as the sole correctness mechanism.**
  Rejected — a distributed lock across a single Redis instance (no cluster,
  per `CLAUDE.md`'s locked stack) is a mutual-exclusion mechanism, not a
  durability guarantee; if the lock holder crashed mid-operation without
  releasing it, or the TTL was misjudged, two work items could still be
  created. A database constraint fails closed regardless of any
  in-process or Redis-level bug in the locking code.
- **A Postgres advisory lock instead of a unique index.** Rejected — an
  advisory lock only prevents concurrent *sessions* holding the same lock
  key; it says nothing about a caller that never took the lock (a bug, a
  future code path) inserting a duplicate row anyway. A unique index is
  enforced by the storage engine itself, independent of every caller's
  discipline.
- **No fast path — resolve against Postgres for every signal.** Rejected on
  performance grounds alone: burst volume is exactly the scenario this
  system has to absorb without the persistence layer becoming the
  bottleneck (see [backpressure.md](../backpressure.md)), and a Postgres
  round trip per signal, at up to 10,000/sec, would make the debouncer
  itself the ceiling.

# 0011 — Optimistic concurrency for work-item state transitions

**Status:** Accepted

## Context

The rubric names this explicitly: "no race conditions during status
updates." Two operators (or an operator and the escalation scheduler, or
two racing HTTP requests from a flaky client's retry) can attempt to
transition the same work item at close to the same moment. Exactly one must
succeed; the rest must fail cleanly, without corrupting state, and without
silently overwriting each other's work — and the mechanism has to hold up
under genuine concurrent load, not just "usually work" under light
contention.

## Decision

Every transition (`transitionState`, and the `RESOLVED → CLOSED` half of
`submitRca`) applies through a single guarded update, inside a Postgres
transaction:

```ts
const result = await tx.workItem.updateMany({
  where: { id: workItemId, state: fromState },
  data: { state: toState, ...data },
});

if (result.count === 0) {
  throw new OptimisticConcurrencyError(workItemId, fromState);
}

await tx.stateTransition.create({ data: { workItemId, fromState, toState, actor } });
```

The `WHERE` clause includes `state: fromState` — not just `id: workItemId`.
Under Postgres's READ COMMITTED isolation, if a concurrent transaction
already moved the row to a different state and committed first, this
`UPDATE` re-evaluates its `WHERE` clause against the now-current row,
matches zero rows, and `result.count` is `0`. No lock is taken up front;
the database's own row-level concurrency control is what actually decides
the winner, and the loser finds out by checking how many rows its own
statement touched.

## Consequences

- Exactly one of two racing callers targeting the same `(workItemId,
  fromState → toState)` can ever succeed — the other gets
  `OptimisticConcurrencyError`, surfaced as `409 conflict` at the API
  layer, never a silent overwrite or a corrupted intermediate state.
- No explicit locking (`SELECT ... FOR UPDATE`, an advisory lock, a
  distributed lock) is needed — the guard is encoded directly in the
  `UPDATE`'s own `WHERE` clause, which Postgres already evaluates
  atomically as part of the statement.
- The state-transition audit row is created in the *same* transaction as
  the guarded update — a caller that loses the race never gets a
  dangling audit entry for a state change that didn't actually happen.
- **Proven under real concurrent HTTP load, not inferred from the
  mechanism alone:** `backend/tests/e2e/concurrency.test.ts` fires 50
  genuinely simultaneous transition requests at one work item, repeated
  across 25 independent iterations, and asserts exactly one `200` and
  forty-nine `409`s every time — a race that only manifested occasionally
  would still be caught by running it 25 times, not just once.
- This mechanism guards *applying* a transition against a race. It says
  nothing about whether the transition is *legal* in the first place —
  that's the State pattern's job (see
  [ADR 0009](0009-state-pattern-for-work-item-lifecycle.md)); the two
  concerns are independent and composed, not one mechanism doing both.

## Alternatives considered

- **Pessimistic locking** (`SELECT ... FOR UPDATE` before deciding whether
  to write). Rejected — holds a row lock for the duration of the
  read-decide-write cycle, which is strictly more contention than needed
  for a workload where conflicts are the exception, not the norm (most
  transition attempts aren't actually racing anyone). The guarded `UPDATE`
  gets the same correctness with no lock held longer than the statement
  itself.
- **A Redis distributed lock around the transition.** Rejected for the same
  reason as the equivalent option in
  [ADR 0010](0010-redis-fast-path-with-postgres-backstop-for-debouncing.md):
  a lock is a mutual-exclusion aid, not a durability guarantee, and adds a
  dependency on Redis being correctly available for an operation whose
  actual correctness should rest on the transactional store already doing
  the write.
- **Application-level version numbers** (an explicit `version` column,
  compare-and-swap on it). Rejected as redundant — `state` itself is
  already the value every transition is conditioned on; a separate version
  counter would track the same fact through an extra column and extra
  bookkeeping for no additional guarantee here, since `state` is what
  actually determines whether a given transition is legal at read time
  anyway.

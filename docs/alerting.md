# Alerting

How a work item's severity and channels get decided, how duplicate alerts are
prevented, and how escalation works. Design pattern and extension mechanics
are in the [README's Design Patterns section](../README.md#design-patterns);
this doc is the behavioral reference. Implementation:
`src/domain/alerting/` (pure policy) and `src/services/alerting/` (delivery,
dedup, escalation — I/O).

## Strategy per component type

Each row is one `AlertStrategy` implementation
(`src/domain/alerting/strategies/`). "Escalation delay" and "escalates to"
are `getEscalationPolicy(severity)`'s policy *at the strategy's floor
severity* — the actual delay/target used for a given work item depends on
its *reconciled* severity (see below), which can be more urgent than the
floor.

| Component type | Severity floor | Channels | Escalation delay (at floor) | Escalates to |
|---|---|---|---|---|
| `RDBMS` | P0 | pagerduty, slack | 5 min | pagerduty |
| `API` | P1 | pagerduty, slack | 15 min | slack |
| `NOSQL` | P1 | pagerduty, slack | 15 min | slack |
| `MCP_HOST` | P1 | slack, email | 15 min | slack |
| `QUEUE` | P1 | slack | 15 min | slack |
| `CACHE` | P2 | slack | 60 min | email |
| *(unregistered type)* — `DefaultAlertStrategy` | P2 | email | 60 min | email |

Rationale for each floor lives as a doc comment on its strategy class (e.g.
RDBMS is P0 because it's the source of truth and a shared dependency for
everything downstream; Cache is P2 because a failure degrades latency, not
correctness, since reads fall back to Postgres on a miss).

## Severity reconciliation

A signal reports its own severity; a strategy has a component-criticality
floor. `reconcileSeverity(floor, reported)` (`domain/alerting/severity.ts`)
returns whichever is *more* severe:

```
reconcileSeverity(floor, reported) = reported if rank(reported) < rank(floor) else floor
```

The floor is a **minimum, never a cap**. An RDBMS floor of P0 means nothing
ever under-alerts a relational-store outage, even if the triggering signal
was reported as P2. Conversely, a normally-quiet Cache component (floor P2)
can still produce a genuinely P0-worthy failure, and that signal's severity
passes through unclamped — silently flattening it to the component's usual
baseline would suppress a real emergency. Whichever side is more urgent
wins, in both directions. Full reasoning: [docs/decisions/0006-severity-reconciliation-rule.md](decisions/0006-severity-reconciliation-rule.md).

This is computed once, in `AlertStrategy.buildAlert()`, using each
strategy's own floor — never re-implemented per strategy, so it can't drift.
The escalation scheduler recomputes it independently per tick (against the
strategy resolved for that work item's `componentType`) since a work item's
escalation delay depends on it too.

## Deduplication

**One alert per work item creation, not per signal.** The debouncer already
collapses a burst into one work item; the worker only calls
`dispatcher.dispatch(workItem, "created")` when the debounce resolution for
*this* invocation reported `created: true`. That flag is reliable for "a
createWorkItem call happened just now" but not proof against a BullMQ retry
re-delivering the same job — the real guarantee is a Redis claim:

```
claimAlertDelivery(redis, workItemId, eventType, windowSeconds)
  = SET alert:sent:<workItemId>:<eventType> 1 EX <windowSeconds> NX
```

`dispatch()` only sends if the `SET ... NX` succeeds — i.e., is the first
caller to claim that `(workItemId, eventType)` pair within the suppression
window (`ALERT_SUPPRESSION_WINDOW_SECONDS`, default 24h). This is what
actually prevents a double-send across a process restart or two replicas
racing on the same job, not the `created` flag or any in-process state —
proven directly in
`tests/integration/services/alertDispatcher.test.ts` by constructing two
independent `AlertDispatcher` instances sharing one Redis and dispatching
concurrently from both.

**Re-alert on state transition, not per signal.** `eventType` is
`"created" | "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED"` — each is its
own claim key, so a work item alerts once on creation and again, with a
distinctly worded message, on every subsequent transition
(`WorkflowService.transitionWorkItem`/`submitIncidentRca` call
`dispatcher.dispatch(workItem, toState)` right after persisting). Signal
volume within a state (e.g. 400 more signals arriving for an already-OPEN
work item) never triggers a second alert.

## Delivery

`AlertDispatcher.dispatch()` resolves the strategy for the work item's
`componentType`, renders the alert, and fans out concurrently to
`ConsoleNotifier` (always on) plus every channel the strategy specifies,
via `NotifierRegistry`. Each channel send is wrapped in the shared
`retry()` backoff wrapper (`ALERT_MAX_ATTEMPTS`, default 3) and a per-channel
timeout (`ALERT_CHANNEL_TIMEOUT_MS`, default 5s via `AbortController`) so one
hanging webhook can't stall the others or the worker. A channel exhausting
its retries is logged and counted (`ims_alerts_total{outcome="failed"}` —
see [docs/observability.md](observability.md)) — it never throws out of
`dispatch()`, which itself never throws: delivery failures must never block
or fail the ingestion pipeline. Missing webhook config (`ALERT_SLACK_WEBHOOK_URL`
etc.) disables that channel at startup with a warning, not a crash.

## Escalation

`EscalationScheduler` polls on `ESCALATION_CHECK_INTERVAL_MS` (default 60s)
for work items still `OPEN` past their *reconciled* severity's
`acknowledgeWithinMs`. The Postgres query itself uses the widest possible
cutoff (P0's, the shortest delay) to get a safe superset of candidates
cheaply in one query; each candidate is then re-checked against its own
actual reconciled-severity delay before escalating — proven in
`tests/integration/services/escalationScheduler.test.ts` with a CACHE work
item that's past P0's delay (in the candidate set) but nowhere near its own
P2 delay (correctly not escalated).

**At most once per level.** `dispatchEscalation()` claims via
`claimEscalationLevel` — a Redis `SADD` on a per-work-item set of escalated
levels (only level 1 exists today; the `SADD`-based tracker is designed so a
future multi-tier policy doesn't need a redesign) — and only proceeds if the
claim newly added a member. **Stops once state leaves OPEN**, not via an
explicit acknowledge step: the scheduler's own query
(`findOpenWorkItemsOlderThan`) only ever returns `OPEN` work items, so a
transitioned-away item simply stops appearing as a candidate on the next
tick.

Escalation targets **only the reconciled severity's `escalateTo` channel**
(from `getEscalationPolicy`), not the strategy's full channel list — an API
failure normally pages `[pagerduty, slack]`, but its P1 escalation goes to
`slack` alone. A successful escalation also writes an audit-trail row: a
harmless `OPEN → OPEN` self-transition in `state_transitions`, distinguished
by `actor: "system:escalation"` — reuses the existing table instead of a
schema migration.

# 0006 — Severity reconciliation: floor is a minimum, never a cap

**Status:** Accepted

## Context

A signal arrives with its own reported severity (whatever the source system
believed at emit time). A component type's `AlertStrategy` also has a
`severityFloor` reflecting that component's structural criticality — an
RDBMS failure is never "wait and see" regardless of what any one signal
says. These two values can disagree in either direction: a routine Cache
blip might be over-reported as P0 by a noisy source, or a genuinely
system-wide RDBMS outage might arrive under-reported as P2 by a signal
source that doesn't know better. Some single rule has to decide which one
wins, and it has to be the *same* rule for every component type — computed
once, not re-implemented per strategy where it could quietly drift.

## Decision

`reconcileSeverity(floor, reported)` (`src/domain/alerting/severity.ts`)
returns whichever of the two is more severe by rank (`P0 > P1 > P2 > P3`):

```ts
reconcileSeverity(floor, reported) =
  reported if rank(reported) < rank(floor) else floor
```

The floor is a **minimum, never a cap**: a signal can only push severity
*up* from the floor, never down. `reconcileSeverity("P0", "P3")` is `"P0"`
(the RDBMS floor wins — nothing under-alerts a critical component).
`reconcileSeverity("P2", "P0")` is `"P0"` (the signal wins — a normally-calm
Cache component's floor doesn't get to swallow a signal that's actually
screaming). Every `AlertStrategy.buildAlert()` calls this same function with
its own floor; it is the single place this comparison exists.

## Consequences

- A critical component (RDBMS, floor P0) can never be under-alerted by a
  signal source that mis-reports severity — the floor is a hard guarantee,
  not a suggestion.
- A normally-low-severity component can still surface a genuine emergency —
  the floor never suppresses a signal that's more severe than the
  component's baseline.
- The escalation scheduler must reconcile independently per tick (against
  the strategy resolved for that work item's `componentType`), since a work
  item's escalation delay is a function of its reconciled severity, not its
  raw reported one, and severity isn't stored pre-reconciled anywhere —
  recomputed from `(strategy.severityFloor, workItem.severity)` each time
  it's needed, which costs nothing (a Map lookup and a comparison) and
  guarantees it can never read stale relative to the current strategy
  registry.
- No situation exists where the *reported* severity is trusted below the
  floor — there's no "low-priority override" path. If a future requirement
  needs one (e.g., a human explicitly downgrading an alert), it has to be a
  deliberate, separate mechanism — not a variant of this function, which is
  intentionally one-directional in its guarantee.

## Alternatives considered

- **Reported severity always wins.** Rejected — a source system
  mis-reporting or under-reporting severity for a critical component (e.g.
  a generic error handler that always reports P2) would silently
  under-alert an RDBMS outage. The floor exists specifically to prevent
  this.
- **Floor always wins (component type solely determines severity).**
  Rejected — collapses every signal from a component to its baseline
  severity regardless of what's actually happening, which would suppress a
  genuine P0-worthy failure in a normally-low-severity component (the
  assignment's own example: "P2 for Cache failure" is a default, not an
  absolute ceiling).
- **A weighted/averaged severity** (e.g. numeric blend of floor and
  reported). Rejected — severity is an ordinal, discrete scale
  (P0–P3) tied to concrete response-time SLAs (`getEscalationPolicy`); an
  averaged value has no natural interpretation against those SLAs and would
  need its own rounding rule that reintroduces the same "which direction do
  we round" question this ADR already answers directly.

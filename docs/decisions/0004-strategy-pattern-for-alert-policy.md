# 0004 — Strategy pattern for alert policy

**Status:** Accepted

## Context

Different component types need different alert severity floors, notification
channels, and escalation targets — an RDBMS outage always pages, a Cache
failure defaults to Slack. The assignment explicitly requires "the right
design pattern to swap alerting logic," and the same design has to satisfy
a harder constraint from `CLAUDE.md`: adding a new component type must not
require editing any existing, already-tested code, and specifically must
never be implemented as a `switch`/`if-else` on `componentType`. That
constraint has to be provably true, not just intended, since it's the kind
of thing that regresses silently the first time someone's in a hurry.

## Decision

One class per component type implementing a shared `AlertStrategy`
interface (`{ componentType, severityFloor, buildAlert(context): Alert }`),
under `src/domain/alerting/strategies/`. An `AlertStrategyRegistry` resolves
`componentType → AlertStrategy` via a `Map`, falling back to a
`DefaultAlertStrategy` for anything unregistered. Registering a new
component type is `registry.register(new MyStrategy())` — one call, zero
edits to the registry, the dispatcher, the escalation scheduler, or any
other strategy. A dedicated test
(`tests/unit/domain/alerting/noBranchingOnComponentType.test.ts`) statically
scans every file under `domain/alerting/` for a `switch` or an `if` keyed on
`componentType` and fails the build if one appears — verified during
development by deliberately introducing one and confirming the test caught
it, then reverting.

Severity is computed by reconciling the strategy's floor against the
triggering signal's own reported severity (see
[0006](0006-severity-reconciliation-rule.md)), inside `buildAlert()` — so
the strategy owns the full policy for its component type, not just the
channel list.

## Consequences

- Adding a component type is additive: one new file, one registration call.
  No existing strategy, the registry, or any caller needs to change.
- The "no branching on componentType" constraint is enforced by a test, not
  a code-review convention — it can't silently regress.
- Every strategy duplicates the same three-line shape (reconcile severity,
  build the alert, return it) — accepted as the cost of each component
  type's policy being independently readable and independently testable,
  rather than centralizing shared logic into a base class that would then
  need its own extension point.
- `AlertStrategyRegistry.resolve()` never throws for an unrecognized
  `componentType` — it falls back to `DefaultAlertStrategy` — so a signal
  from a component type nobody's registered a policy for yet still gets a
  conservative default alert instead of crashing the pipeline or being
  silently dropped.

## Alternatives considered

- **A single function with a `switch` on `componentType`.** Rejected —
  exactly what `CLAUDE.md` and the assignment rule out; every new component
  type would be a diff to existing, already-tested code, and severity/channel
  logic for six-plus component types in one function becomes unreadable
  fast.
- **A config-driven table** (a plain object or JSON mapping `componentType`
  to severity/channels) instead of classes. Rejected — works for the
  current, uniform shape (floor + channels + templated text), but each
  component type's `buildAlert` logic isn't guaranteed to always be a
  straight-line template; a class gives every component type room to
  diverge (different escalation logic, different context fields) without
  the config schema needing to grow a new special case for the first one
  that does.
- **Inheritance** (a base `AlertStrategy` class with template methods,
  concrete strategies only overriding what differs). Rejected — the
  strategies genuinely don't share enough structure to justify a base class
  beyond the interface itself; `reconcileSeverity`/`getEscalationPolicy` are
  already the shared logic, factored out as standalone pure functions each
  strategy calls, which is simpler than a class hierarchy for two shared
  function calls.

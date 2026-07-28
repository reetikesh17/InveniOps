# Design Patterns

The assignment requires "the right design pattern" for two things — swapping alerting
logic per component type, and managing work-item state transitions — and `CLAUDE.md`
adds a harder constraint on top: neither may be a `switch`/`if-else` on the thing that
varies, because that turns "add a new case" into a diff against existing, already-tested
code instead of an addition. This document is the mechanics: the real interfaces, how
dispatch actually happens, and — for each pattern — exactly what changes to add a new
case and, just as importantly, what doesn't. See [architecture.md](architecture.md) for
where these sit in the codebase and why `domain/` has to stay I/O-free for either
pattern to be unit-testable without a running database.

## State — work item lifecycle

**Implementation:** `backend/src/domain/state/`. **Behavioral reference for the
guard that gates CLOSED:** [ADR 0011](decisions/0011-optimistic-concurrency-for-state-transitions.md)
covers the concurrency side of applying a transition; this document covers the state
graph itself. **Why State, specifically, over the alternatives:**
[ADR 0009](decisions/0009-state-pattern-for-work-item-lifecycle.md).

### The interface

```ts
// domain/state/types.ts
export type WorkItemStateName = "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";

export interface TransitionContext<TPayload = unknown> {
  readonly workItem: WorkItemSnapshot;
  readonly to: WorkItemStateName;
  readonly payload?: TPayload;
}

export type TransitionGuard = (context: TransitionContext) => boolean;

export interface WorkItemState {
  readonly name: WorkItemStateName;
  transition(context: TransitionContext): WorkItemState;
  getLegalNextStates(): readonly WorkItemStateName[];
}
```

Every concrete state — `OpenState`, `InvestigatingState`, `ResolvedState`,
`ClosedState` — extends `BaseWorkItemState`, which is the actual dispatch mechanism:

```ts
// domain/state/baseWorkItemState.ts
export interface TransitionEntry {
  readonly target: WorkItemState;
  readonly guard?: TransitionGuard;
}

export abstract class BaseWorkItemState implements WorkItemState {
  abstract readonly name: WorkItemStateName;
  private readonly transitions: ReadonlyMap<WorkItemStateName, TransitionEntry>;

  constructor(transitions: readonly TransitionEntry[]) {
    this.transitions = new Map(transitions.map((entry) => [entry.target.name, entry]));
  }

  transition(context: TransitionContext): WorkItemState {
    const entry = this.transitions.get(context.to);
    if (!entry || (entry.guard && !entry.guard(context))) {
      throw new InvalidTransitionError(this.name, context.to);
    }
    return entry.target;
  }

  getLegalNextStates(): readonly WorkItemStateName[] {
    return [...this.transitions.keys()];
  }
}
```

Dispatch is a `Map` lookup (`this.transitions.get(context.to)`), not a chain of `if
(context.to === "INVESTIGATING")`. A concrete state's constructor declares its own
outbound edges and nothing else:

```ts
// domain/state/openState.ts — OPEN's only legal edge is to INVESTIGATING
export class OpenState extends BaseWorkItemState {
  readonly name = "OPEN" as const;
  constructor(investigatingState: WorkItemState) {
    super([{ target: investigatingState }]);
  }
}

// domain/state/resolvedState.ts — RESOLVED's only edge is to CLOSED, and it's guarded
export class ResolvedState extends BaseWorkItemState {
  readonly name = "RESOLVED" as const;
  constructor(closedState: WorkItemState, canClose: TransitionGuard) {
    super([{ target: closedState, guard: canClose }]);
  }
}

// domain/state/closedState.ts — terminal: an empty transition list means
// every transition() call throws InvalidTransitionError, unconditionally
export class ClosedState extends BaseWorkItemState {
  readonly name = "CLOSED" as const;
  constructor() {
    super([]);
  }
}
```

`ResolvedState` is the only state constructed with a guard. That guard —
`createRcaCloseGuard` (`domain/rca/closeGuard.ts`) — is what makes CLOSED unreachable
without a complete RCA, and it's enforced at exactly this layer, not by the API
deciding to check first:

```ts
// domain/rca/closeGuard.ts
export function createRcaCloseGuard(clock: () => Date): TransitionGuard {
  return (context: TransitionContext): boolean => {
    if (!isRcaRecord(context.payload)) return false;
    const result = validateRca(context.payload, {
      firstSignalAt: context.workItem.firstSignalAt,
      now: clock(),
    });
    return result.valid;
  };
}
```

There is no second code path to CLOSED that skips this guard. `WorkflowService`'s plain
`transitionWorkItem` method never supplies an RCA payload, so a bare
`RESOLVED → CLOSED` attempt through it always fails the guard by construction — closing
only happens through `submitIncidentRca`, which is the one caller that actually builds
an RCA payload to hand the guard. `tests/unit/services/workitems/workflowService.test.ts`
calls the service directly, with no HTTP layer involved, and proves this — the domain
layer rejects an incomplete close on its own, not because a route handler happened to
check first.

Finally, `graph.ts` wires the four instances together — the one place that knows the
full shape of the lifecycle:

```ts
// domain/state/graph.ts
export function createWorkItemStateGraph(canClose: TransitionGuard): WorkItemStateGraph {
  const closed = new ClosedState();
  const resolved = new ResolvedState(closed, canClose);
  const investigating = new InvestigatingState(resolved);
  const open = new OpenState(investigating);
  return { OPEN: open, INVESTIGATING: investigating, RESOLVED: resolved, CLOSED: closed };
}
```

### Extension walkthrough: adding a `REOPENED` state

Say a closed incident needs to be reopened — `CLOSED → REOPENED`, and `REOPENED`
behaves like a fresh `OPEN`. Here's exactly what changes:

1. **Add the name.** `WorkItemStateName` gains `"REOPENED"` (`domain/state/types.ts`).
2. **Write one new class.** `domain/state/reopenedState.ts`, extending
   `BaseWorkItemState`, declaring `REOPENED`'s own outbound edges (presumably back to
   `INVESTIGATING`, mirroring `OpenState`).
3. **Give `ClosedState` an edge to it.** `ClosedState`'s constructor currently passes
   an empty transition list (`super([])`) — it would instead pass
   `super([{ target: reopenedState }])`, and its constructor signature changes to
   accept `reopenedState: WorkItemState`, the same pattern every other state already
   uses to reference the states it can reach.
4. **Wire it into the graph.** `createWorkItemStateGraph` constructs the new instance
   and includes it in the returned record.

**What does not change:** every other state class (`OpenState`, `InvestigatingState`,
`ResolvedState`) — none of them reference `CLOSED` or `REOPENED` in a way this touches.
`BaseWorkItemState`'s dispatch logic — a `Map` lookup doesn't care how many entries are
in the map. `WorkflowService`, the dashboard projection's `legalNextStates` field, and
every API route — all of them call `.transition()` and `.getLegalNextStates()` against
the `WorkItemState` interface, never against a name or a switch, so a new state
appearing in the graph is immediately legal everywhere that already asks "what can this
work item legally do next" without a single one of those call sites changing. The only
edit outside `domain/state/` is `Prisma`'s `WorkItemStatus` enum, since `REOPENED` needs
to be a storable value — a migration, not an application-logic change.

### Why not a switch statement

The tempting alternative is one function: `canTransition(from, to)` with a `switch` on
`from`, or a lookup table keyed by `${from}->${to}`. Two things break with that shape as
soon as a transition needs a guard: the guard has to be threaded through as a second
parameter with its own conditional logic, and every caller that wants to know "what can
this state legally do next" has to duplicate the same switch in reverse to enumerate
outcomes — which is exactly the `getLegalNextStates()` method the dashboard needs to
render legal action buttons. A `switch` also means every new state is a diff to an
existing, already-tested function, not a new file; the class-per-state shape makes
"add a `REOPENED` state" the walkthrough above — one new file, one one-line edit to the
state it now attaches to — instead of a growing conditional nobody wants to touch.

## Strategy — alert severity/channel selection

**Implementation:** `backend/src/domain/alerting/`. **Behavioral reference (the actual
per-component floor/channel/escalation table, deduplication, delivery):**
[alerting.md](alerting.md). **Why Strategy over the alternatives:**
[ADR 0004](decisions/0004-strategy-pattern-for-alert-policy.md). **The severity-floor
reconciliation rule every strategy calls into:**
[ADR 0006](decisions/0006-severity-reconciliation-rule.md).

### The interface

```ts
// domain/alerting/types.ts
export interface AlertContext {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly reportedSeverity: Severity;
  readonly signalCount: number;
  readonly firstSignalAt: Date;
}

export interface Alert {
  readonly severity: Severity;       // reconciled — see ADR 0006
  readonly channels: readonly NotificationChannel[];
  readonly escalation: EscalationPolicy;
  readonly title: string;
  readonly body: string;
}

export interface AlertStrategy {
  readonly componentType: string;
  readonly severityFloor: Severity;
  buildAlert(context: AlertContext): Alert;
}
```

`buildAlert` is required to be pure — no I/O, nothing imported from `services/` or
`repositories/` — so every strategy can be unit-tested by constructing a context object
and asserting on the returned `Alert`, with no database, no Redis, no notifier.

One class per component type, `strategies/rdbmsStrategy.ts` through
`strategies/queueStrategy.ts`, plus `defaultStrategy.ts` for anything unregistered. Each
is a few lines — reconcile severity against the floor, return an `Alert`:

```ts
// domain/alerting/strategies/cacheStrategy.ts
export class CacheAlertStrategy implements AlertStrategy {
  readonly componentType = "CACHE";
  readonly severityFloor = "P2" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["slack"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] Cache failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. Dashboard reads will fall back to Postgres and run slower, but data is not at risk.`,
    };
  }
}
```

Resolution is a `Map`, not a conditional:

```ts
// domain/alerting/registry.ts
export class AlertStrategyRegistry {
  private readonly strategies = new Map<string, AlertStrategy>();

  constructor(private readonly fallback: AlertStrategy, initial: readonly AlertStrategy[] = []) {
    for (const strategy of initial) this.register(strategy);
  }

  register(strategy: AlertStrategy): void {
    this.strategies.set(strategy.componentType, strategy);
  }

  resolve(componentType: string): AlertStrategy {
    return this.strategies.get(componentType) ?? this.fallback;
  }
}

export function createDefaultAlertStrategyRegistry(): AlertStrategyRegistry {
  return new AlertStrategyRegistry(new DefaultAlertStrategy(), [
    new RdbmsAlertStrategy(), new NosqlAlertStrategy(), new CacheAlertStrategy(),
    new ApiAlertStrategy(), new McpHostAlertStrategy(), new QueueAlertStrategy(),
  ]);
}
```

`resolve()` never throws for an unrecognized `componentType` — it falls back to
`DefaultAlertStrategy`, so a signal from a component type nobody's written a policy for
yet still gets a conservative default alert instead of crashing the pipeline.

### Extension walkthrough: adding a `LOAD_BALANCER` component type

1. **Write one new class.** `domain/alerting/strategies/loadBalancerStrategy.ts`,
   implementing `AlertStrategy` — pick a `severityFloor`, pick `channels`, write
   `buildAlert()`. Nothing to extend, no base class required beyond the interface.
2. **Register it once.** In `createDefaultAlertStrategyRegistry()`
   (`domain/alerting/registry.ts`), add `new LoadBalancerAlertStrategy()` to the array
   passed to the constructor — or call `registry.register(...)` later, at runtime, if
   the use case ever needs a dynamically-added strategy instead of a boot-time one.

**What does not change:** every existing strategy file — none of them know or care that
a new one exists. `AlertStrategyRegistry` — its `resolve()`/`register()` methods are
already generic over any `componentType` string; adding an entry to the `Map` needs no
new branch. `AlertDispatcher` and `EscalationScheduler` — both resolve through
`registry.resolve(workItem.componentType)` and have never seen a `LOAD_BALANCER`-shaped
special case to add. The `ComponentType` union in `domain/alerting/types.ts` is
deliberately not closed (`"API" | "MCP_HOST" | ... | (string & {})`) specifically so
registering a type the union doesn't even list yet — say, ahead of a schema migration
that adds it — is a valid, supported thing to do, not a type error to work around.

### Why not a switch statement

This is enforced, not just documented: `tests/unit/domain/alerting/noBranchingOnComponentType.test.ts`
statically scans every file under `domain/alerting/` for a `switch` or an `if` keyed on
`componentType` and fails the build if one appears. It was verified to actually catch
regressions during development by deliberately introducing one and confirming the test
failed, then reverting. The reason to want this in the first place is the same as
State's: a `switch` across six-plus component types, each with its own floor, channel
list, and message template, becomes unreadable fast, and every new component type is a
diff to that same growing function — one more branch added to code that was already
shipped and tested, instead of one new file that ships independently of everything
already there.

## Both patterns, one shape

State and Strategy solve different problems (sequencing valid transitions vs. selecting
a policy per category) but share the same structural answer: a common interface, one
class per concrete case, and a lookup — a `Map` in Strategy's case, constructor-injected
references forming a graph in State's — instead of conditional dispatch on the thing
that varies (a state name, a component type). That's what makes "add a new case"
additive: a new file plus one registration call, never an edit to code that's already
shipped and already has tests protecting it.

### A note on debouncing

The debounce mechanism (100 signals for one component within 10 seconds collapse to one
work item) is sometimes assumed to be a third pattern here, but it deliberately isn't
domain code and doesn't follow either shape above. Unlike State and Strategy, the
debounce *decision* can't be made from in-memory data alone — "does an active work item
already exist for this component" is a question about current database state, not a
pure function of the signal itself. `SignalDebouncer` (`services/ingestion/debouncer.ts`)
is a service for exactly that reason: it checks a Redis-cached session first, falls back
to a real Postgres query on a miss, and defers to a database constraint
(`idx_work_items_active_component_id`) as the actual correctness guarantee under
concurrent creation. See
[ADR 0010](decisions/0010-redis-fast-path-with-postgres-backstop-for-debouncing.md) for
the full design and why a cache-plus-constraint hybrid was chosen over alternatives like
a pure Redis lock or a Postgres advisory lock.

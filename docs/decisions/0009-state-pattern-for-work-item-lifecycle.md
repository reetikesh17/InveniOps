# 0009 — State pattern for the work-item lifecycle

**Status:** Accepted

## Context

The assignment requires managing `OPEN → INVESTIGATING → RESOLVED → CLOSED`
transitions "using the right design pattern," and `CLAUDE.md` adds the same
constraint this project already applies to alerting: the mechanism must be
provably not a `switch`/`if-else` chain, because that shape makes every new
rule (a new state, a new guard) a diff against code that's already shipped
and already tested. On top of sequencing, one transition is conditional in
a way the others aren't — `RESOLVED → CLOSED` must be rejected unless a
complete RCA accompanies it — and that rule has to be enforced somewhere a
second caller (a future bulk-close script, a worker, anything) can't
route around it.

## Decision

One class per state (`OpenState`, `InvestigatingState`, `ResolvedState`,
`ClosedState`), each extending `BaseWorkItemState` and implementing a shared
`WorkItemState` interface (`transition(context)`, `getLegalNextStates()`).
Legal outbound edges are declared once, in each state's own constructor, as
a list of `{ target: WorkItemState, guard?: TransitionGuard }` entries that
`BaseWorkItemState` stores as a `Map<WorkItemStateName, TransitionEntry>` —
dispatch is a map lookup, never a conditional on the state's name.
`createWorkItemStateGraph()` (`domain/state/graph.ts`) wires the four
instances together into a traversable graph, injecting `ResolvedState`'s
only edge with a guard — `createRcaCloseGuard`
(`domain/rca/closeGuard.ts`) — that validates a supplied RCA payload and
rejects the transition outright if it's missing or incomplete. Full
interfaces, the extension walkthrough, and why a switch was avoided:
[design-patterns.md](../design-patterns.md#state--work-item-lifecycle).

## Consequences

- `CLOSED` is unreachable without a complete RCA as a structural property of
  the graph, not an API-layer check that a second caller could skip —
  `WorkflowService`'s plain transition method never supplies an RCA
  payload, so it can never satisfy the guard; only `submitIncidentRca` can.
- Adding a new state (see the design-patterns.md walkthrough) is one new
  file plus a one-line edit to whichever existing state now points at it —
  no existing state class, and nothing outside `domain/state/`, needs to
  change.
- `getLegalNextStates()` gives every caller (the dashboard's "what actions
  can I show for this work item" query, the API's own transition validation)
  a single, always-correct source for legal actions, computed from the same
  graph that enforces them — there's no separate list to keep in sync.
- The state graph only decides whether a transition is *legal*; it says
  nothing about concurrent callers racing to apply the *same* legal
  transition at once. That's a separate guarantee — see
  [ADR 0011](0011-optimistic-concurrency-for-state-transitions.md).

## Alternatives considered

- **A single function with a `switch`/lookup table on `(fromState, toState)`.**
  Rejected — the same reasoning as [ADR 0004](0004-strategy-pattern-for-alert-policy.md):
  every new state or rule is a diff to an existing, already-tested function,
  and threading a conditional guard (the RCA-completeness check) through a
  table entry is more awkward than a class simply being constructed with
  one.
- **A boolean/enum flag on the work item itself** (e.g. `canClose: boolean`
  computed and stored ad hoc) instead of a guarded transition. Rejected —
  couples "is this closeable" to a mutable field that has to be kept in
  sync with the RCA's actual completeness by every writer, instead of being
  computed once, at the moment of the attempt, from the RCA payload actually
  being submitted.
- **A full state machine library** (e.g. XState). Rejected as more
  machinery than four states and one guarded edge justify — the entire
  graph fits in five small files, and a library's generic event/context
  model would add abstraction this project's actual shape doesn't need.

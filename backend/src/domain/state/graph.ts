import { ClosedState } from "./closedState.js";
import { ResolvedState } from "./resolvedState.js";
import { InvestigatingState } from "./investigatingState.js";
import { OpenState } from "./openState.js";
import type { TransitionGuard, WorkItemState, WorkItemStateName } from "./types.js";

export type WorkItemStateGraph = Readonly<Record<WorkItemStateName, WorkItemState>>;

// canClose has no default — this module never decides on its own what counts
// as a valid RCA. The real predicate is injected by whoever wires this up
// once the RCA module (next prompt) exists.
export function createWorkItemStateGraph(canClose: TransitionGuard): WorkItemStateGraph {
  const closed = new ClosedState();
  const resolved = new ResolvedState(closed, canClose);
  const investigating = new InvestigatingState(resolved);
  const open = new OpenState(investigating);

  return {
    OPEN: open,
    INVESTIGATING: investigating,
    RESOLVED: resolved,
    CLOSED: closed,
  };
}

// Structural query only — takes just a state name, so it can't evaluate a
// context-dependent guard. The internal graph's guard is never invoked here;
// its value is irrelevant to the result.
export function getLegalNextStates(state: WorkItemStateName): readonly WorkItemStateName[] {
  const graph = createWorkItemStateGraph(() => true);
  return graph[state].getLegalNextStates();
}

import { InvalidTransitionError } from "./errors.js";
import type { TransitionContext, TransitionGuard, WorkItemState, WorkItemStateName } from "./types.js";

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

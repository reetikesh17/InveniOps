import { BaseWorkItemState } from "./baseWorkItemState.js";
import type { TransitionGuard, WorkItemState } from "./types.js";

export class ResolvedState extends BaseWorkItemState {
  readonly name = "RESOLVED" as const;

  constructor(closedState: WorkItemState, canClose: TransitionGuard) {
    super([{ target: closedState, guard: canClose }]);
  }
}

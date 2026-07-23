import { BaseWorkItemState } from "./baseWorkItemState.js";
import type { WorkItemState } from "./types.js";

export class InvestigatingState extends BaseWorkItemState {
  readonly name = "INVESTIGATING" as const;

  constructor(resolvedState: WorkItemState) {
    super([{ target: resolvedState }]);
  }
}

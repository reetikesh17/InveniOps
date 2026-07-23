import { BaseWorkItemState } from "./baseWorkItemState.js";
import type { WorkItemState } from "./types.js";

export class OpenState extends BaseWorkItemState {
  readonly name = "OPEN" as const;

  constructor(investigatingState: WorkItemState) {
    super([{ target: investigatingState }]);
  }
}

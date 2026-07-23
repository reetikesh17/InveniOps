import { BaseWorkItemState } from "./baseWorkItemState.js";

// Terminal — empty transitions list means every transition() call throws.
export class ClosedState extends BaseWorkItemState {
  readonly name = "CLOSED" as const;

  constructor() {
    super([]);
  }
}

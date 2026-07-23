import type { WorkItemStateName } from "./types.js";

export class InvalidTransitionError extends Error {
  readonly currentState: WorkItemStateName;
  readonly attemptedState: WorkItemStateName;

  constructor(currentState: WorkItemStateName, attemptedState: WorkItemStateName) {
    super(`Cannot transition work item from ${currentState} to ${attemptedState}`);
    this.name = "InvalidTransitionError";
    this.currentState = currentState;
    this.attemptedState = attemptedState;
  }
}

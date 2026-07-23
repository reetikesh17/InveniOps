export class OptimisticConcurrencyError extends Error {
  readonly workItemId: string;
  readonly expectedState: string;

  constructor(workItemId: string, expectedState: string) {
    super(
      `Work item ${workItemId} is no longer in state ${expectedState} — it was changed by another writer or does not exist.`,
    );
    this.name = "OptimisticConcurrencyError";
    this.workItemId = workItemId;
    this.expectedState = expectedState;
  }
}

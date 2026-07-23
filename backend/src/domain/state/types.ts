export type WorkItemStateName = "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";

// Deliberately minimal — just what state-transition logic (and, now, the
// RCA close guard) needs. Will align with the real WorkItem shape once the
// Postgres schema lands; not importing it now since domain/ must stay free
// of repository/service dependencies.
export interface WorkItemSnapshot {
  readonly id: string;
  readonly state: WorkItemStateName;
  readonly firstSignalAt: Date;
}

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

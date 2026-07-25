import type { WorkItemState } from "./enums";

// Mirrors backend src/services/dashboard/dashboardProjection.ts's
// StateTransitionDto — what GET /api/v1/incidents/:id/transitions returns
// (the Incident Detail page's audit trail). fromState === toState is a
// real, valid row: the escalation scheduler records escalations on this
// same trail as a no-op state update, distinguishable only by that equality
// (see backend/src/repositories/postgres/workItemRepository.ts's
// recordEscalation).
export interface StateTransition {
  readonly id: string;
  readonly workItemId: string;
  readonly fromState: WorkItemState;
  readonly toState: WorkItemState;
  readonly actor: string;
  readonly occurredAt: string;
}

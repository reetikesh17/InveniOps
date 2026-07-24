import type { WorkItemState } from "./enums";

// Mirrors the Prisma StateTransition model shape (prisma/schema.prisma) —
// no backend endpoint returns this directly yet (there's no audit-trail
// route today), included for forward compatibility per the shared-types
// spec and so a future audit-trail view has a ready-made type.
export interface StateTransition {
  readonly id: string;
  readonly workItemId: string;
  readonly fromState: WorkItemState;
  readonly toState: WorkItemState;
  readonly actor: string;
  readonly occurredAt: string;
}

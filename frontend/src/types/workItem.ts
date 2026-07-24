import type { ComponentType, Severity, WorkItemState } from "./enums";
import type { RcaRecord } from "./rca";

// Mirrors backend src/repositories/redis/dashboardCache.ts's
// IncidentSummary — the shape GET /api/v1/incidents and the incident
// mutation endpoints (transition/RCA) return. Dates are ISO-8601 strings on
// the wire, not Date objects.
export interface WorkItem {
  readonly id: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly state: WorkItemState;
  readonly title: string;
  readonly firstSignalAt: string;
  readonly signalCount: number;
  readonly updatedAt: string;
}

// Mirrors backend src/services/dashboard/dashboardProjection.ts's
// IncidentDetailDto — what GET /api/v1/incidents/:id returns.
export interface IncidentDetail extends WorkItem {
  readonly legalNextStates: readonly WorkItemState[];
  readonly rca: RcaRecord | null;
}

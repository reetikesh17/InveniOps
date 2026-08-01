import type { RootCauseCategory } from "./enums";

// Mirrors backend src/services/dashboard/dashboardProjection.ts's
// RcaSummaryDto — nested under IncidentDetail.rca once a work item is CLOSED.
export interface RcaRecord {
  readonly incidentStartTime: string;
  readonly incidentEndTime: string;
  readonly rootCauseCategory: RootCauseCategory;
  readonly rootCauseDescription: string;
  readonly fixApplied: string;
  readonly preventionSteps: string;
  readonly mttrSeconds: number;
  readonly submittedAt: string;
}

// What POST /api/v1/incidents/:id/rca expects as its body — see
// backend/src/api/routes/workitems.ts's handleSubmitRca. No `actor` field —
// the server sources that from the authenticated request (see
// hooks/useAuth.tsx), not anything the client asserts.
export interface RcaSubmissionInput {
  readonly incidentStartTime: string;
  readonly incidentEndTime: string;
  readonly rootCauseCategory: RootCauseCategory;
  readonly rootCauseDescription: string;
  readonly fixApplied: string;
  readonly preventionSteps: string;
}

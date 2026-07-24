// Mirrors backend src/services/dashboard/dashboardProjection.ts's
// SignalDto exactly, including componentType/severity being plain `string`
// (not the narrow ComponentType/Severity unions) — the backend's
// SignalDocument itself stores these loosely (MongoDB is schemaless there;
// see docs/data-model.md), so narrowing them here would claim a guarantee
// the wire data doesn't actually have.
export interface Signal {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: string;
  readonly severity: string;
  readonly rawPayload: unknown;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly workItemId: string | null;
}

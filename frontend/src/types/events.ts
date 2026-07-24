import type { WorkItem } from "./workItem";

// Mirrors backend src/services/realtime/incidentEvents.ts's IncidentEvent —
// the payload pushed over GET /api/v1/incidents/stream (see
// src/hooks/useIncidents.ts and docs/decisions/0007-sse-for-real-time-transport.md).
export type IncidentEventType = "work_item_created" | "work_item_state_changed";

export interface WorkItemCreatedEvent {
  readonly type: "work_item_created";
  readonly incident: WorkItem;
}

export interface WorkItemStateChangedEvent {
  readonly type: "work_item_state_changed";
  readonly incident: WorkItem;
  readonly fromState: string;
  readonly toState: string;
}

export type IncidentEvent = WorkItemCreatedEvent | WorkItemStateChangedEvent;

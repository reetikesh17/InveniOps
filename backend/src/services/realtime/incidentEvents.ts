import type { IncidentSummary } from "../../repositories/redis/dashboardCache.js";

export const INCIDENT_EVENTS_CHANNEL = "incidents:events";

export type IncidentEventType = "work_item_created" | "work_item_state_changed";

export interface WorkItemCreatedEvent {
  readonly type: "work_item_created";
  readonly incident: IncidentSummary;
}

export interface WorkItemStateChangedEvent {
  readonly type: "work_item_state_changed";
  readonly incident: IncidentSummary;
  readonly fromState: string;
  readonly toState: string;
}

export type IncidentEvent = WorkItemCreatedEvent | WorkItemStateChangedEvent;

export function isIncidentEvent(value: unknown): value is IncidentEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type: unknown }).type !== undefined &&
    ((value as { type: unknown }).type === "work_item_created" ||
      (value as { type: unknown }).type === "work_item_state_changed")
  );
}

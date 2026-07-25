import type { ComponentType, Severity, WorkItem, WorkItemState } from "../../types";

export interface IncidentFilters {
  readonly severity: Severity | "";
  readonly state: WorkItemState | "";
  readonly componentType: ComponentType | "";
}

/** Reads filter state out of the URL query string — the single source of truth, so a filtered view is always shareable via its URL. */
export function parseFilters(params: URLSearchParams): IncidentFilters {
  return {
    severity: (params.get("severity") as Severity | null) ?? "",
    state: (params.get("state") as WorkItemState | null) ?? "",
    componentType: (params.get("componentType") as ComponentType | null) ?? "",
  };
}

/**
 * Filters an already backend-sorted list — never reorders it, so the
 * severity/recency order the server chose survives filtering untouched.
 */
export function applyFilters(incidents: readonly WorkItem[], filters: IncidentFilters): readonly WorkItem[] {
  return incidents.filter(
    (incident) =>
      (filters.severity === "" || incident.severity === filters.severity) &&
      (filters.state === "" || incident.state === filters.state) &&
      (filters.componentType === "" || incident.componentType === filters.componentType),
  );
}

export function hasActiveFilters(filters: IncidentFilters): boolean {
  return filters.severity !== "" || filters.state !== "" || filters.componentType !== "";
}

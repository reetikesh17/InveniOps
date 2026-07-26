import { useSearchParams } from "react-router-dom";
import { Button, Select } from "../../components";
import { COMPONENT_TYPES, SEVERITIES, WORK_ITEM_STATES } from "../../types";
import { hasActiveFilters, parseFilters } from "./incidentFilters";

const SEVERITY_OPTIONS = [{ value: "", label: "All severities" }, ...SEVERITIES.map((value) => ({ value, label: value }))];
// Active-view filter only lists the *active* states — CLOSED is excluded here
// because the active feed never contains closed incidents (they live under the
// "Closed" view toggle, see FeedViewToggle). Offering "Closed" here would be a
// filter that can never match anything.
const ACTIVE_STATES = WORK_ITEM_STATES.filter((state) => state !== "CLOSED");
const STATE_OPTIONS = [
  { value: "", label: "All states" },
  ...ACTIVE_STATES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() })),
];
const COMPONENT_TYPE_OPTIONS = [
  { value: "", label: "All component types" },
  ...COMPONENT_TYPES.map((value) => ({ value, label: value })),
];

/**
 * Filter state lives entirely in the URL query string (via useSearchParams)
 * rather than component state — that's what makes a filtered Live Feed view
 * shareable by URL, per the spec. Filtering itself happens in the parent
 * (see incidentFilters.applyFilters) against the already backend-sorted
 * list; this component only ever reads/writes the query string.
 */
export function IncidentFilterBar(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);

  function setFilter(key: "severity" | "state" | "componentType", value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <Select
          label="Severity"
          value={filters.severity}
          onChange={(e) => setFilter("severity", e.target.value)}
          options={SEVERITY_OPTIONS}
        />
      </div>
      <div className="w-40">
        <Select
          label="State"
          value={filters.state}
          onChange={(e) => setFilter("state", e.target.value)}
          options={STATE_OPTIONS}
        />
      </div>
      <div className="w-48">
        <Select
          label="Component type"
          value={filters.componentType}
          onChange={(e) => setFilter("componentType", e.target.value)}
          options={COMPONENT_TYPE_OPTIONS}
        />
      </div>
      {hasActiveFilters(filters) && (
        <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

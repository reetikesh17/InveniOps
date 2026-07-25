import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, EmptyState, ErrorState, IncidentListSkeleton } from "../../components";
import { CheckCircleIcon, ExclamationTriangleIcon } from "../../components/icons";
import { useIncidents, type IncidentsConnectionStatus } from "../../hooks/useIncidents";
import { IncidentFilterBar } from "./IncidentFilterBar";
import { IncidentHeaderStats } from "./IncidentHeaderStats";
import { IncidentTable } from "./IncidentTable";
import { applyFilters, hasActiveFilters, parseFilters } from "./incidentFilters";
import { Pagination } from "./Pagination";

// The Live Feed's own working set, fetched once (plus SSE-triggered
// refetches) — the backend's own max page size (see DASHBOARD_LIST_MAX_LIMIT
// in backend/src/config/index.ts), so this is a bounded fetch, not an
// unbounded one. Filtering and pagination below both happen client-side on
// top of this already backend-sorted batch. If active-incident volume ever
// regularly exceeds this cap, true server-driven pagination (re-fetching a
// new offset per page) would be the next step — not needed at this scale.
const FETCH_LIMIT = 200;
const PAGE_SIZE = 25;

const TRANSPORT_CONFIG: Record<IncidentsConnectionStatus, { label: string; dotClassName: string }> = {
  connecting: { label: "Connecting…", dotClassName: "bg-neutral-400" },
  live: { label: "Live", dotClassName: "bg-emerald-500" },
  polling: { label: "Polling (live updates unavailable)", dotClassName: "bg-amber-500" },
};

function TransportStatusPill({ status }: { status: IncidentsConnectionStatus }): JSX.Element {
  const { label, dotClassName } = TRANSPORT_CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function LiveFeedPage(): JSX.Element {
  const { data, loading, error, connectionStatus, refresh } = useIncidents({ limit: FETCH_LIMIT });
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const filtered = applyFilters(data, filters);

  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Resets to page 1 only when the user actually changes a filter — never
  // when `data` itself refreshes (SSE push or the 5s poll), which would
  // otherwise yank an operator back to page 1 mid-review.
  useEffect(() => {
    setPage(1);
  }, [filters.severity, filters.state, filters.componentType]);

  // Clamps downward if the current page no longer exists (e.g. incidents
  // resolved out of the filtered set while paused on a later page) —
  // distinct from the reset above, and never fires from a same-size refresh.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink">Live Feed</h1>
        <TransportStatusPill status={connectionStatus} />
      </div>

      <IncidentHeaderStats incidents={data} />
      <IncidentFilterBar />

      {error && data.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-red-500" />
          <span className="text-red-800">Couldn&apos;t refresh incidents — showing the last known data.</span>
          <Button variant="secondary" onClick={refresh} className="ml-auto">
            Retry
          </Button>
        </div>
      )}

      {loading && data.length === 0 ? (
        <IncidentListSkeleton />
      ) : data.length === 0 && error ? (
        <ErrorState message={error.message} onRetry={refresh} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={<CheckCircleIcon className="h-8 w-8" />}
          headline="No active incidents"
          body="Everything is quiet — new incidents will appear here as they come in."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          headline="No incidents match these filters"
          body="Try widening your severity, state, or component type filter."
          action={
            hasActiveFilters(filters) ? (
              <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <IncidentTable incidents={pageItems} />
          <Pagination page={page} pageCount={pageCount} totalCount={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

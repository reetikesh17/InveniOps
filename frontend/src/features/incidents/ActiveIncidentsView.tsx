import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  EmptyState,
  ErrorState,
  IncidentListSkeleton,
  MONO_MICRO_CLASSES,
} from "../../components";
import { CheckCircleIcon, ExclamationTriangleIcon } from "../../components/icons";
import { friendlyErrorMessage } from "../../lib/errorMessages";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useIncidents, type IncidentsConnectionStatus } from "../../hooks/useIncidents";
import { FeedViewToggle } from "./FeedViewToggle";
import { IncidentFilterBar } from "./IncidentFilterBar";
import { IncidentTable } from "./IncidentTable";
import { applyFilters, hasActiveFilters, parseFilters } from "./incidentFilters";
import { Pagination } from "./Pagination";

// Filtering and pagination below both happen client-side on top of the
// already backend-sorted, bounded batch the shared IncidentsProvider fetches
// (see hooks/useIncidents.tsx — the same working set the header's live
// severity counts are drawn from).
const PAGE_SIZE = 25;

// Neutral by default; only polling (a degraded transport) borrows the P1 hue.
const TRANSPORT_CONFIG: Record<
  IncidentsConnectionStatus,
  { label: string; dotStyle: CSSProperties }
> = {
  connecting: {
    label: "connecting",
    dotStyle: { boxShadow: "inset 0 0 0 1.5px var(--color-ink-faint)" },
  },
  live: { label: "live", dotStyle: { backgroundColor: "var(--color-ink)" } },
  polling: {
    label: "polling · updates delayed",
    dotStyle: { backgroundColor: "var(--color-severity-p1)" },
  },
};

function TransportStatusPill({ status }: { status: IncidentsConnectionStatus }): JSX.Element {
  const { label, dotStyle } = TRANSPORT_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${MONO_MICRO_CLASSES}`}>
      <span className="h-2 w-2 rounded-full" style={dotStyle} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ActiveIncidentsView(): JSX.Element {
  useDocumentTitle("Live Feed");
  const { data, loading, error, connectionStatus, refresh } = useIncidents();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const filtered = applyFilters(data, filters);

  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showSkeleton = useDelayedFlag(loading && data.length === 0);

  // Resets to page 1 only when the user actually changes a filter — never
  // when `data` itself refreshes (SSE push or the 5s poll), which would
  // otherwise yank an operator back to page 1 mid-review.
  useEffect(() => {
    setPage(1);
  }, [filters.severity, filters.state, filters.componentType]);

  // Clamps downward if the current page no longer exists (e.g. incidents
  // resolved out of the filtered set while paused on a later page).
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-bold uppercase tracking-[0.1em] text-ink">
            Live Feed
          </h1>
          <FeedViewToggle view="active" />
        </div>
        <TransportStatusPill status={connectionStatus} />
      </div>

      <IncidentFilterBar />

      {error && data.length > 0 && (
        <div
          role="alert"
          style={{ borderLeftColor: "var(--color-severity-p0)" }}
          className="flex flex-wrap items-center gap-3 rounded-md border border-border border-l-[3px] bg-surface-raised px-4 py-2.5 text-sm"
        >
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-severity-p0" />
          <span className="font-body text-ink">
            Couldn&apos;t refresh incidents — showing the last known data.
          </span>
          <Button variant="secondary" onClick={refresh} className="ml-auto">
            Retry
          </Button>
        </div>
      )}

      {loading && data.length === 0 ? (
        showSkeleton ? (
          <IncidentListSkeleton />
        ) : null
      ) : data.length === 0 && error ? (
        <ErrorState message={friendlyErrorMessage(error, "incidents")} onRetry={refresh} />
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
              <Button
                variant="secondary"
                onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <IncidentTable incidents={pageItems} />
          <Pagination
            page={page}
            pageCount={pageCount}
            totalCount={filtered.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, IncidentListSkeleton } from "../../components";
import { ArchiveIcon } from "../../components/icons";
import { friendlyErrorMessage } from "../../lib/errorMessages";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { FeedViewToggle } from "./FeedViewToggle";
import { IncidentTable } from "./IncidentTable";
import { Pagination } from "./Pagination";
import { useClosedIncidents } from "./useClosedIncidents";

const PAGE_SIZE = 25;

function parsePage(params: URLSearchParams): number {
  const raw = Number(params.get("page"));
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/**
 * Closed-incident history — the "where did my closed cases go" view. Unlike
 * the active feed this is a cold, static list: server-paginated (history is
 * unbounded), no real-time transport, no client-side filters. Rows still link
 * to the detail page, where the read-only RCA and final MTTR live.
 */
export function ClosedIncidentsView(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams);
  const { items, total, loading, error, refetch } = useClosedIncidents(page, PAGE_SIZE);
  const showSkeleton = useDelayedFlag(loading && items.length === 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setPage(next: number): void {
    const params = new URLSearchParams(searchParams);
    params.set("view", "closed");
    if (next <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(next));
    }
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">Closed incidents</h1>
          <FeedViewToggle view="closed" />
        </div>
        {total > 0 && <span className="text-sm text-ink-muted">{total} total</span>}
      </div>

      {loading && items.length === 0 ? (
        showSkeleton ? (
          <IncidentListSkeleton />
        ) : null
      ) : error && items.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(error, "closed incidents")} onRetry={refetch} />
      ) : total === 0 ? (
        <EmptyState
          icon={<ArchiveIcon className="h-8 w-8" />}
          headline="No closed incidents yet"
          body="Once an incident is closed with an RCA, it moves here for history."
        />
      ) : (
        <>
          <IncidentTable incidents={items} />
          <Pagination page={page} pageCount={pageCount} totalCount={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

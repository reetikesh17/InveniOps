import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, RelativeTime, SeverityBadge, SkeletonBlock } from "../../components";
import { ChevronDownIcon } from "../../components/icons";
import { api, ApiRequestError, type ApiErrorInfo } from "../../lib/api";
import { SEVERITIES, type Severity, type Signal } from "../../types";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 20;
type Order = "asc" | "desc";

function toErrorInfo(error: unknown): ApiErrorInfo {
  if (error instanceof ApiRequestError) {
    return error.info;
  }
  return { kind: "unknown", status: 0, message: error instanceof Error ? error.message : "unexpected error" };
}

function isKnownSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

function SignalRow({ signal }: { signal: Signal }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-muted"
      >
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
        {isKnownSeverity(signal.severity) ? (
          <SeverityBadge severity={signal.severity} />
        ) : (
          <span className="text-xs font-semibold text-ink-muted">{signal.severity}</span>
        )}
        <RelativeTime value={signal.receivedAt} className="text-ink-muted" />
        <span className="ml-auto truncate text-xs text-ink-faint">{signal.signalId}</span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto bg-surface-muted px-3 py-2.5 text-xs text-ink">
          {JSON.stringify(signal.rawPayload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export interface SignalsPanelProps {
  readonly incidentId: string;
}

/** Paginated, load-on-demand — an incident can have thousands of linked signals, so this never fetches more than one page at a time. */
export function SignalsPanel({ incidentId }: SignalsPanelProps): JSX.Element {
  const [order, setOrder] = useState<Order>("desc");
  const [page, setPage] = useState(1);
  const [signals, setSignals] = useState<readonly Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const fetchPage = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getIncidentSignals(incidentId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, order });
      setSignals(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setLoading(false);
    }
  }, [incidentId, page, order]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  function setOrderAndResetPage(next: Order): void {
    setOrder(next);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant={order === "desc" ? "primary" : "secondary"}
          onClick={() => setOrderAndResetPage("desc")}
          disabled={loading}
        >
          Newest first
        </Button>
        <Button
          variant={order === "asc" ? "primary" : "secondary"}
          onClick={() => setOrderAndResetPage("asc")}
          disabled={loading}
        >
          Oldest first
        </Button>
      </div>

      {loading && signals.length === 0 ? (
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="h-9 w-full" />
        </div>
      ) : error ? (
        <ErrorState message="Couldn't load signals for this incident." onRetry={() => void fetchPage()} />
      ) : total === 0 ? (
        <EmptyState headline="No signals recorded" body="Nothing has been linked to this incident yet." />
      ) : (
        <>
          <ul className="overflow-hidden rounded-lg border border-border">
            {signals.map((signal) => (
              <SignalRow key={signal.signalId} signal={signal} />
            ))}
          </ul>
          <Pagination page={page} pageCount={pageCount} totalCount={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

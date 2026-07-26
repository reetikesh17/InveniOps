import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, RelativeTime, SeverityBadge, SkeletonBlock } from "../../components";
import { ChevronDownIcon } from "../../components/icons";
import { api, ApiRequestError, type ApiErrorInfo } from "../../lib/api";
import { friendlyErrorMessage } from "../../lib/errorMessages";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
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
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
        {isKnownSeverity(signal.severity) ? (
          <SeverityBadge severity={signal.severity} />
        ) : (
          <span className="text-xs font-semibold text-ink-muted">{signal.severity}</span>
        )}
        <RelativeTime value={signal.receivedAt} className="font-mono text-mono-num tabular-nums text-ink-muted" />
        <span className="ml-auto truncate font-mono text-mono-id text-ink-muted">{signal.signalId}</span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto bg-surface-muted px-3 py-2.5 font-mono text-xs text-ink">
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
  const [reloadNonce, setReloadNonce] = useState(0);

  // Fetch is aborted on unmount and whenever the page/order/incident changes,
  // so a slow response for a page the operator has already navigated away from
  // never lands as a state update on an unmounted (or stale) view.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getIncidentSignals(incidentId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, order }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        setSignals(result.items);
        setTotal(result.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setError(toErrorInfo(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [incidentId, page, order, reloadNonce]);

  function setOrderAndResetPage(next: Order): void {
    setOrder(next);
    setPage(1);
  }

  const retry = (): void => setReloadNonce((n) => n + 1);
  const showSkeleton = useDelayedFlag(loading && signals.length === 0);
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
        showSkeleton ? (
          <div className="flex flex-col gap-2">
            <SkeletonBlock className="h-9 w-full" />
            <SkeletonBlock className="h-9 w-full" />
            <SkeletonBlock className="h-9 w-full" />
          </div>
        ) : null
      ) : error ? (
        <ErrorState message={friendlyErrorMessage(error, "signals")} onRetry={retry} />
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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_BASE_URL, api, ApiRequestError, type ApiErrorInfo } from "../lib/api";
import type { WorkItem } from "../types";

// Describes the real-time transport only — "connecting" (initial attempt or
// mid-backoff reconnect), "live" (SSE connected), "polling" (degraded
// fallback, see the hook's own comment). Data-fetch failures are reported
// independently via `error` below, regardless of which of these is active.
export type IncidentsConnectionStatus = "connecting" | "live" | "polling";

export interface UseIncidentsResult {
  readonly data: readonly WorkItem[];
  readonly loading: boolean;
  readonly error: ApiErrorInfo | null;
  readonly connectionStatus: IncidentsConnectionStatus;
  readonly refresh: () => void;
}

const IncidentsContext = createContext<UseIncidentsResult | null>(null);

// The backend's own max page size (see DASHBOARD_LIST_MAX_LIMIT in
// backend/src/config/index.ts) — one bounded working set shared by the Live
// Feed table and the header's live severity counts, so there's exactly one
// list fetch / SSE subscription in flight for the whole app, not one per
// consumer (the same reasoning as HealthProvider's single /health poller).
const FETCH_LIMIT = 200;

// Matches the console reporter's own 5s cadence elsewhere in this system —
// see docs/observability.md — for a consistent sense of "how fresh is
// this" across the whole app.
const POLL_INTERVAL_MS = 5_000;
const MAX_SSE_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// Collapses a burst of events (e.g. one debounced signal storm creating a
// work item, or several transitions in quick succession) into one refetch
// instead of one per event.
const REFETCH_DEBOUNCE_MS = 300;

function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

function toErrorInfo(error: unknown): ApiErrorInfo {
  if (error instanceof ApiRequestError) {
    return error.info;
  }
  return { kind: "unknown", status: 0, message: error instanceof Error ? error.message : "unexpected error" };
}

/**
 * The single incidents subscription for the whole app — fetches the
 * active-incident list, then tries to stay current in real time over SSE
 * (GET /api/v1/incidents/stream — see
 * docs/decisions/0007-sse-for-real-time-transport.md), reconnecting with
 * capped exponential backoff on drop. If SSE can't be established after
 * MAX_SSE_RETRIES attempts, degrades to polling the same list endpoint on
 * POLL_INTERVAL_MS rather than leaving the UI stuck on stale data — the
 * cache-backed list read stays correct and reasonably fresh either way.
 *
 * SSE events are treated as a refetch trigger, not a merge source — see the
 * ADR for why (mainly: avoids duplicating the backend's sort order
 * client-side). Drives both the Live Feed table and the header's live
 * severity counts off one shared fetch/SSE connection (the same reasoning as
 * HealthProvider).
 */
export function IncidentsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [data, setData] = useState<readonly WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<IncidentsConnectionStatus>("connecting");

  const mountedRef = useRef(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listControllerRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);

  const fetchList = useCallback(async (): Promise<void> => {
    // Supersede any in-flight list read (a rapid SSE burst can trigger several)
    // and abort it on unmount — no stale page ever overwrites a newer one.
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    try {
      const page = await api.listIncidents({ limit: FETCH_LIMIT }, { signal: controller.signal });
      if (controller.signal.aborted || !mountedRef.current) {
        return;
      }
      setData(page.items);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError") || !mountedRef.current) {
        return;
      }
      setError(toErrorInfo(err));
    } finally {
      if (!controller.signal.aborted && mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const scheduleRefetch = useCallback((): void => {
    if (refetchDebounceRef.current) {
      clearTimeout(refetchDebounceRef.current);
    }
    refetchDebounceRef.current = setTimeout(() => void fetchList(), REFETCH_DEBOUNCE_MS);
  }, [fetchList]);

  const stopPolling = useCallback((): void => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback((): void => {
    if (pollTimerRef.current) {
      return;
    }
    setConnectionStatus("polling");
    pollTimerRef.current = setInterval(() => void fetchList(), POLL_INTERVAL_MS);
  }, [fetchList]);

  const connectSse = useCallback((): void => {
    if (eventSourceRef.current) {
      return;
    }
    const source = new EventSource(`${API_BASE_URL}/api/v1/incidents/stream`);
    eventSourceRef.current = source;

    source.addEventListener("open", () => {
      if (!mountedRef.current) {
        return;
      }
      retryCountRef.current = 0;
      stopPolling();
      setConnectionStatus("live");
    });

    const onIncidentEvent = (): void => scheduleRefetch();
    source.addEventListener("work_item_created", onIncidentEvent);
    source.addEventListener("work_item_state_changed", onIncidentEvent);

    source.addEventListener("error", () => {
      source.close();
      eventSourceRef.current = null;
      if (!mountedRef.current) {
        return;
      }

      retryCountRef.current += 1;
      if (retryCountRef.current > MAX_SSE_RETRIES) {
        startPolling();
        return;
      }
      setConnectionStatus("connecting");
      reconnectTimerRef.current = setTimeout(connectSse, backoffDelayMs(retryCountRef.current));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connectSse intentionally references itself for reconnect scheduling
  }, [scheduleRefetch, startPolling, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchList();
    connectSse();

    return () => {
      mountedRef.current = false;
      listControllerRef.current?.abort();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (refetchDebounceRef.current) {
        clearTimeout(refetchDebounceRef.current);
      }
      stopPolling();
    };
    // Intentionally mount-only: connectSse/fetchList are read via stable
    // callbacks, and FETCH_LIMIT is a fixed constant, so this effect never
    // needs to react to a dependency change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback((): void => {
    void fetchList();
  }, [fetchList]);

  const value = useMemo<UseIncidentsResult>(
    () => ({ data, loading, error, connectionStatus, refresh }),
    [data, loading, error, connectionStatus, refresh],
  );

  return <IncidentsContext.Provider value={value}>{children}</IncidentsContext.Provider>;
}

export function useIncidents(): UseIncidentsResult {
  const ctx = useContext(IncidentsContext);
  if (!ctx) {
    throw new Error("useIncidents must be used within an IncidentsProvider");
  }
  return ctx;
}

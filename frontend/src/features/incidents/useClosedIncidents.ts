import { useEffect, useState } from "react";
import { api, ApiRequestError, type ApiErrorInfo } from "../../lib/api";
import type { WorkItem } from "../../types";

export interface UseClosedIncidentsResult {
  readonly items: readonly WorkItem[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: ApiErrorInfo | null;
  readonly refetch: () => void;
}

function toErrorInfo(error: unknown): ApiErrorInfo {
  if (error instanceof ApiRequestError) {
    return error.info;
  }
  return {
    kind: "unknown",
    status: 0,
    message: error instanceof Error ? error.message : "unexpected error",
  };
}

/**
 * Closed-incident history: true server-side pagination (unlike the active
 * feed, which fetches one bounded page and slices client-side) because the
 * closed set grows without bound. No SSE/polling — history is static; a page
 * only refetches when the page number changes or on an explicit retry. The
 * request is aborted on unmount/page-change so a slow response never lands
 * on a stale view.
 */
export function useClosedIncidents(page: number, pageSize: number): UseClosedIncidentsResult {
  const [items, setItems] = useState<readonly WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .listClosedIncidents(
        { limit: pageSize, offset: (page - 1) * pageSize },
        { signal: controller.signal },
      )
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setError(toErrorInfo(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [page, pageSize, nonce]);

  return { items, total, loading, error, refetch: () => setNonce((n) => n + 1) };
}

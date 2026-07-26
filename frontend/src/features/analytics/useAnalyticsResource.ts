import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, type ApiErrorInfo, type CallOptions } from "../../lib/api";

export interface AnalyticsResource<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: ApiErrorInfo | null;
  readonly refetch: () => void;
}

function toErrorInfo(error: unknown): ApiErrorInfo {
  if (error instanceof ApiRequestError) {
    return error.info;
  }
  return { kind: "unknown", status: 0, message: error instanceof Error ? error.message : "unexpected error" };
}

/**
 * Generic loader for one analytics endpoint: refetches whenever `deps`
 * change (the shared range/interval flow through here), aborts the in-flight
 * request on change/unmount, and never lets a stale response overwrite a
 * newer one. Panels read {data, loading, error} and render the empty case
 * themselves from the shape of `data`.
 */
export function useAnalyticsResource<T>(
  fetcher: (opts: CallOptions) => Promise<T>,
  deps: readonly unknown[],
): AnalyticsResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [nonce, setNonce] = useState(0);

  // Kept in a ref so a caller passing a fresh arrow each render doesn't
  // retrigger the effect — only `deps` (and refetch) drive a reload.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetcherRef.current({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setError(toErrorInfo(err));
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's declared inputs; fetcher is read via ref
  }, [...deps, nonce]);

  const refetch = useCallback((): void => setNonce((n) => n + 1), []);

  return { data, loading, error, refetch };
}

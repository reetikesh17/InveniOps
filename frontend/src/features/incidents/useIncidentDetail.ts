import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError, type ApiErrorInfo } from "../../lib/api";
import type { IncidentDetail } from "../../types";

export interface UseIncidentDetailResult {
  readonly detail: IncidentDetail | null;
  readonly loading: boolean;
  readonly error: ApiErrorInfo | null;
  readonly notFound: boolean;
  readonly refresh: () => Promise<void>;
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
 * Always refetches the full detail rather than trying to patch a partial
 * response (e.g. a transition's WorkItem-shaped result) into the existing
 * object — legalNextStates and rca are only ever trustworthy straight from
 * GET /api/v1/incidents/:id, never hand-assembled client-side. Every action
 * on the detail page (transition, RCA submission, conflict) settles by
 * calling `refresh`, which is what makes "the server's state wins on any
 * disagreement" actually true rather than aspirational.
 */
export function useIncidentDetail(id: string): UseIncidentDetailResult {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Tracks the in-flight request so a new fetch (or unmount) aborts the prior
  // one — no state update ever lands from a superseded or torn-down request.
  const controllerRef = useRef<AbortController | null>(null);

  const fetchDetail = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await api.getIncident(id, { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      setDetail(result);
      setNotFound(false);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      if (err instanceof ApiRequestError && err.info.kind === "not_found") {
        setNotFound(true);
      } else {
        setError(toErrorInfo(err));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    void fetchDetail();
    return () => controllerRef.current?.abort();
  }, [fetchDetail]);

  return { detail, loading, error, notFound, refresh: fetchDetail };
}

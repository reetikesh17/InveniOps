import type {
  ComponentHealth,
  GroupedAnalyticsQuery,
  HealthResponse,
  IncidentCountsResponse,
  IncidentDetail,
  MttrTrendResponse,
  Page,
  PaginationParams,
  RcaSubmissionInput,
  Signal,
  ThroughputQuery,
  ThroughputResponse,
  WorkItem,
  WorkItemState,
} from "../types";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

// A discriminated union, not a generic Error — every case a caller might
// need to branch on for a distinct UI treatment gets its own `kind`. Network
// failure and timeout have no HTTP status (the request never got a
// response); the rest carry the status that produced them, even though it's
// implied by `kind`, so a component that only cares about "is this a 4xx"
// doesn't need a lookup table.
export type ApiErrorInfo =
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "timeout"; readonly message: string; readonly timeoutMs: number }
  | { readonly kind: "validation"; readonly status: 400; readonly message: string; readonly fieldErrors: readonly FieldError[] }
  | { readonly kind: "not_found"; readonly status: 404; readonly message: string }
  | { readonly kind: "conflict"; readonly status: 409; readonly message: string; readonly reason: string }
  | { readonly kind: "invalid_rca"; readonly status: 422; readonly message: string; readonly fieldErrors: readonly FieldError[] }
  | { readonly kind: "unavailable"; readonly status: 503; readonly message: string }
  | { readonly kind: "unknown"; readonly status: number; readonly message: string };

export class ApiRequestError extends Error {
  readonly info: ApiErrorInfo;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = "ApiRequestError";
    this.info = info;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFieldError(value: unknown): value is FieldError {
  return isRecord(value) && typeof value["field"] === "string" && typeof value["message"] === "string";
}

// The backend isn't fully consistent about which key carries field-level
// errors (workitems.ts uses "errors", signals.ts uses "details") — check
// both rather than assuming one.
function extractFieldErrors(body: Record<string, unknown>): FieldError[] {
  const raw = Array.isArray(body["errors"]) ? body["errors"] : Array.isArray(body["details"]) ? body["details"] : [];
  return raw.filter(isFieldError);
}

function toErrorInfo(status: number, data: unknown): ApiErrorInfo {
  const body = isRecord(data) ? data : {};
  const message = typeof body["message"] === "string" ? body["message"] : `Request failed with status ${status}`;

  switch (status) {
    case 400:
      return { kind: "validation", status, message, fieldErrors: extractFieldErrors(body) };
    case 404:
      return { kind: "not_found", status, message };
    case 409:
      return { kind: "conflict", status, message, reason: typeof body["error"] === "string" ? body["error"] : "conflict" };
    case 422:
      return { kind: "invalid_rca", status, message, fieldErrors: extractFieldErrors(body) };
    case 503:
      return { kind: "unavailable", status, message };
    default:
      return { kind: "unknown", status, message };
  }
}

export interface CallOptions {
  /** For caller-initiated cancellation — e.g. an effect cleanup on unmount. Does not replace the request's own timeout; either firing aborts the request. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

interface RequestOptions extends CallOptions {
  readonly method?: string;
  readonly body?: unknown;
}

interface RawResponse {
  readonly status: number;
  readonly data: unknown;
}

/**
 * Shared fetch/timeout/abort mechanics. Every call gets its own timeout
 * (default 10s), enforced via an internally-owned AbortController; a
 * caller-supplied signal aborts the same controller, so either one firing
 * cancels the request. A caller-initiated abort rethrows the original
 * AbortError untouched (the standard "ignore, this was intentional"
 * pattern for a component unmounting mid-request) rather than wrapping it
 * as an ApiErrorInfo — only genuine timeouts and network failures do that.
 */
async function apiFetchRaw(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  const { body, method, signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onCallerAbort);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (callerSignal?.aborted) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ApiRequestError({ kind: "timeout", message: `request timed out after ${timeoutMs}ms`, timeoutMs });
    }
    throw new ApiRequestError({ kind: "network", message: error instanceof Error ? error.message : "network error" });
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data: unknown = contentType.includes("application/json") ? await response.json() : undefined;
  return { status: response.status, data };
}

/** Throws ApiRequestError for any non-2xx response — see apiFetchRaw for a variant that doesn't. */
export async function apiFetch<T>(path: string, options?: RequestOptions): Promise<T> {
  const { status, data } = await apiFetchRaw(path, options);
  if (status < 200 || status >= 300) {
    throw new ApiRequestError(toErrorInfo(status, data));
  }
  return data as T;
}

// Accepts `object` rather than a Record type deliberately — every call
// site passes one of our own flat query-param interfaces (PaginationParams,
// ThroughputQuery, ...), none of which declare an index signature, so a
// Record-typed parameter would reject them all under TS's structural
// index-signature check. Safe: every field on those interfaces is already
// string | number | boolean | undefined.
function toQueryString(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | boolean | undefined>).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) {
    return "";
  }
  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

export const api = {
  listIncidents(params: PaginationParams = {}, opts?: CallOptions): Promise<Page<WorkItem>> {
    return apiFetch(`/api/v1/incidents${toQueryString(params)}`, opts);
  },

  getIncident(id: string, opts?: CallOptions): Promise<IncidentDetail> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}`, opts);
  },

  getIncidentSignals(id: string, params: PaginationParams = {}, opts?: CallOptions): Promise<Page<Signal>> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}/signals${toQueryString(params)}`, opts);
  },

  transitionIncident(id: string, toState: WorkItemState, actor: string, opts?: CallOptions): Promise<WorkItem> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}/transition`, {
      ...opts,
      method: "POST",
      body: { toState, actor },
    });
  },

  submitRca(id: string, input: RcaSubmissionInput, opts?: CallOptions): Promise<WorkItem & { mttrSeconds: number }> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}/rca`, { ...opts, method: "POST", body: input });
  },

  getThroughput(query: ThroughputQuery, opts?: CallOptions): Promise<ThroughputResponse> {
    return apiFetch(`/api/v1/analytics/throughput${toQueryString(query)}`, opts);
  },

  getMttrTrend(query: GroupedAnalyticsQuery, opts?: CallOptions): Promise<MttrTrendResponse> {
    return apiFetch(`/api/v1/analytics/mttr${toQueryString(query)}`, opts);
  },

  getIncidentCounts(query: GroupedAnalyticsQuery, opts?: CallOptions): Promise<IncidentCountsResponse> {
    return apiFetch(`/api/v1/analytics/incidents${toQueryString(query)}`, opts);
  },

  getComponentHealth(componentId: string, windowSeconds?: number, opts?: CallOptions): Promise<ComponentHealth> {
    return apiFetch(`/api/v1/analytics/components/${encodeURIComponent(componentId)}${toQueryString({ windowSeconds })}`, opts);
  },

  /**
   * Never throws for a normal unhealthy (503) response — that's meaningful
   * data (which dependency is down), not a client error, so this bypasses
   * apiFetch's throw-on-non-2xx behavior and returns the body regardless of
   * status. Genuine network failures/timeouts still throw ApiRequestError,
   * same as every other method.
   */
  async getHealth(opts?: CallOptions): Promise<HealthResponse> {
    const { data } = await apiFetchRaw("/health", opts);
    return data as HealthResponse;
  },
};

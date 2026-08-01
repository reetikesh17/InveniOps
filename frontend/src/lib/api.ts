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
  SignalsQuery,
  StateTransition,
  ThroughputQuery,
  ThroughputResponse,
  User,
  WorkItem,
  WorkItemState,
} from "../types";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const DEFAULT_TIMEOUT_MS = 10_000;

// The access token lives here, in module memory only — never
// localStorage/sessionStorage. Set by AuthContext (hooks/useAuth.tsx) on
// login/signup and cleared on logout or a 401. See that file's own comment
// for the full XSS/CSRF tradeoff this is making; the short version: no
// token in persistent storage for any later script to read, and no
// ambient cookie credential for CSRF to ride on — attaching it here, to
// this one Authorization header, is the only way a request ever carries it.
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** For the one caller that can't attach an Authorization header: the SSE connection (see hooks/useIncidents.tsx) sends this as a query param instead — the server verifies it the same way, just not through the shared requireAuth middleware (see backend/src/api/routes/incidentStream.ts). */
export function getAuthToken(): string | null {
  return authToken;
}

// AuthContext registers this once, at app startup, so apiFetch can react
// to a 401 from *any* call site without every caller having to check for
// it individually — the alternative is every single api.* consumer
// remembering to redirect to /login on 401, which is the kind of thing
// that's fine 9 times out of 10 and silently wrong the 10th.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

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
  | {
      readonly kind: "validation";
      readonly status: 400;
      readonly message: string;
      readonly fieldErrors: readonly FieldError[];
    }
  | { readonly kind: "not_found"; readonly status: 404; readonly message: string }
  | {
      readonly kind: "conflict";
      readonly status: 409;
      readonly message: string;
      readonly reason: string;
    }
  | {
      readonly kind: "invalid_rca";
      readonly status: 422;
      readonly message: string;
      readonly fieldErrors: readonly FieldError[];
    }
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
  return (
    isRecord(value) && typeof value["field"] === "string" && typeof value["message"] === "string"
  );
}

// The backend isn't fully consistent about which key carries field-level
// errors (workitems.ts uses "errors", signals.ts uses "details") — check
// both rather than assuming one.
function extractFieldErrors(body: Record<string, unknown>): FieldError[] {
  const raw = Array.isArray(body["errors"])
    ? body["errors"]
    : Array.isArray(body["details"])
      ? body["details"]
      : [];
  return raw.filter(isFieldError);
}

function toErrorInfo(status: number, data: unknown): ApiErrorInfo {
  const body = isRecord(data) ? data : {};
  const message =
    typeof body["message"] === "string" ? body["message"] : `Request failed with status ${status}`;

  switch (status) {
    case 400:
      return { kind: "validation", status, message, fieldErrors: extractFieldErrors(body) };
    case 404:
      return { kind: "not_found", status, message };
    case 409:
      return {
        kind: "conflict",
        status,
        message,
        reason: typeof body["error"] === "string" ? body["error"] : "conflict",
      };
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
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("timeout", "TimeoutError")),
    timeoutMs,
  );
  const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onCallerAbort);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (callerSignal?.aborted) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ApiRequestError({
        kind: "timeout",
        message: `request timed out after ${timeoutMs}ms`,
        timeoutMs,
      });
    }
    throw new ApiRequestError({
      kind: "network",
      message: error instanceof Error ? error.message : "network error",
    });
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data: unknown = contentType.includes("application/json")
    ? await response.json()
    : undefined;
  return { status: response.status, data };
}

// login/signup's own 401s (wrong password) and 409s (duplicate email) are
// ordinary, expected outcomes the auth pages handle inline — never the
// "your session expired" case setUnauthorizedHandler exists for. Excluded
// by path so a failed login attempt can never itself trigger a redirect
// loop back to the page it's already on.
const AUTH_PATHS_EXEMPT_FROM_UNAUTHORIZED_HANDLER = [
  "/api/v1/auth/login",
  "/api/v1/auth/signup",
  // logout() clears local session state itself; a 401 on its own
  // best-effort server call must not re-trigger the handler and loop.
  "/api/v1/auth/logout",
];

/** Throws ApiRequestError for any non-2xx response — see apiFetchRaw for a variant that doesn't. */
export async function apiFetch<T>(path: string, options?: RequestOptions): Promise<T> {
  const { status, data } = await apiFetchRaw(path, options);
  if (status === 401 && !AUTH_PATHS_EXEMPT_FROM_UNAUTHORIZED_HANDLER.includes(path)) {
    unauthorizedHandler?.();
  }
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
  const entries = Object.entries(
    params as Record<string, string | number | boolean | undefined>,
  ).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined);
  if (entries.length === 0) {
    return "";
  }
  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

export const api = {
  listIncidents(params: PaginationParams = {}, opts?: CallOptions): Promise<Page<WorkItem>> {
    return apiFetch(`/api/v1/incidents${toQueryString(params)}`, opts);
  },

  /** Closed-incident history (status=closed), most recently closed first — server-paginated, since history grows without bound. */
  listClosedIncidents(params: PaginationParams = {}, opts?: CallOptions): Promise<Page<WorkItem>> {
    return apiFetch(`/api/v1/incidents${toQueryString({ ...params, status: "closed" })}`, opts);
  },

  getIncident(id: string, opts?: CallOptions): Promise<IncidentDetail> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}`, opts);
  },

  getIncidentSignals(
    id: string,
    params: SignalsQuery = {},
    opts?: CallOptions,
  ): Promise<Page<Signal>> {
    return apiFetch(
      `/api/v1/incidents/${encodeURIComponent(id)}/signals${toQueryString(params)}`,
      opts,
    );
  },

  getIncidentTransitions(
    id: string,
    opts?: CallOptions,
  ): Promise<{ readonly items: readonly StateTransition[] }> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}/transitions`, opts);
  },

  // No `actor` parameter — the server sources it from the authenticated
  // request (the Authorization header apiFetchRaw already attaches), not
  // anything this client asserts. See docs/decisions/.
  transitionIncident(id: string, toState: WorkItemState, opts?: CallOptions): Promise<WorkItem> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}/transition`, {
      ...opts,
      method: "POST",
      body: { toState },
    });
  },

  submitRca(
    id: string,
    input: RcaSubmissionInput,
    opts?: CallOptions,
  ): Promise<WorkItem & { mttrSeconds: number }> {
    return apiFetch(`/api/v1/incidents/${encodeURIComponent(id)}/rca`, {
      ...opts,
      method: "POST",
      body: input,
    });
  },

  getThroughput(query: ThroughputQuery, opts?: CallOptions): Promise<ThroughputResponse> {
    return apiFetch(`/api/v1/analytics/throughput${toQueryString(query)}`, opts);
  },

  getMttrTrend(query: GroupedAnalyticsQuery, opts?: CallOptions): Promise<MttrTrendResponse> {
    return apiFetch(`/api/v1/analytics/mttr${toQueryString(query)}`, opts);
  },

  getIncidentCounts(
    query: GroupedAnalyticsQuery,
    opts?: CallOptions,
  ): Promise<IncidentCountsResponse> {
    return apiFetch(`/api/v1/analytics/incidents${toQueryString(query)}`, opts);
  },

  getComponentHealth(
    componentId: string,
    windowSeconds?: number,
    opts?: CallOptions,
  ): Promise<ComponentHealth> {
    return apiFetch(
      `/api/v1/analytics/components/${encodeURIComponent(componentId)}${toQueryString({ windowSeconds })}`,
      opts,
    );
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

  signup(
    input: { email: string; password: string; name: string },
    opts?: CallOptions,
  ): Promise<{ user: User; token: string }> {
    return apiFetch("/api/v1/auth/signup", { ...opts, method: "POST", body: input });
  },

  login(
    input: { email: string; password: string },
    opts?: CallOptions,
  ): Promise<{ user: User; token: string }> {
    return apiFetch("/api/v1/auth/login", { ...opts, method: "POST", body: input });
  },

  me(opts?: CallOptions): Promise<User> {
    return apiFetch("/api/v1/auth/me", opts);
  },

  /** With no server-side session, this is symmetry more than effect — see backend/src/api/routes/auth.ts's own comment. The real logout is AuthContext discarding the in-memory token. */
  logout(opts?: CallOptions): Promise<{ ok: true }> {
    return apiFetch("/api/v1/auth/logout", { ...opts, method: "POST" });
  },
};

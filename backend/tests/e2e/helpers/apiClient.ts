// Thin wrapper around the real HTTP API — these tests drive InveniOps
// exactly as an external caller would (same posture as
// tests/chaos/helpers/apiClient.ts), against the real docker-compose
// stack, not an in-process app instance (that's what
// tests/integration/api/lifecycle.test.ts already does).
import { sleep } from "./wait.js";
import { API_BASE_URL } from "./testEnv.js";

export type Severity = "P0" | "P1" | "P2" | "P3";
export type ComponentType = "API" | "MCP_HOST" | "CACHE" | "QUEUE" | "RDBMS" | "NOSQL";
export type WorkItemState = "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";

export interface SignalInput {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly rawPayload: unknown;
  readonly occurredAt: string;
}

export interface IngestResult {
  readonly status: number;
  readonly accepted: number;
  readonly dropped: number;
  readonly rateLimitRetries: number;
}

/**
 * Posts a batch and retries on 429 honoring `Retry-After`, up to 10
 * attempts — 500 signals against the real per-IP token bucket (default
 * capacity 50 / refill 20 per second) will genuinely trip it; a
 * well-behaved client backs off and retries rather than treating that as
 * failure.
 */
export async function postSignals(signals: readonly SignalInput[]): Promise<IngestResult> {
  let retries = 0;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${API_BASE_URL}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
    });

    if (res.status === 429) {
      if (attempt >= 10) {
        throw new Error(`rate limited 10 times in a row posting to ${API_BASE_URL} — giving up`);
      }
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : 1;
      retries += 1;
      await sleep((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1) * 1000 + 50);
      continue;
    }

    const body = (await res.json().catch(() => ({}))) as { accepted?: number; dropped?: number };
    return {
      status: res.status,
      accepted: body.accepted ?? 0,
      dropped: body.dropped ?? 0,
      rateLimitRetries: retries,
    };
  }
}

// The incident/analytics routes below sit behind requireAuth (see
// api/app.ts) — signed up once per test run (not per call) and reused,
// same posture as a real dashboard client that logs in once and holds the
// token in memory. /health and signal ingestion above stay unauthenticated
// on purpose (see api/app.ts's comment) and need no token.
interface AuthIdentity {
  readonly email: string;
  readonly token: string;
}

let cachedIdentity: Promise<AuthIdentity> | undefined;

function getAuthIdentity(): Promise<AuthIdentity> {
  cachedIdentity ??= (async (): Promise<AuthIdentity> => {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "e2e-test-password", name: "E2E Test" }),
    });
    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      throw new Error(`e2e auth signup failed: ${res.status} ${JSON.stringify(body)}`);
    }
    return { email, token: body.token };
  })();
  return cachedIdentity;
}

/** The email every transition/RCA call below is actually authenticated as — what the server now records as `actor`, regardless of any actor string a caller passes in. */
export async function getAuthenticatedEmail(): Promise<string> {
  return (await getAuthIdentity()).email;
}

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${(await getAuthIdentity()).token}` };
}

export interface HealthResponse {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly dependencies: Record<
    "postgres" | "mongo" | "redis" | "queue",
    { status: "up" | "down"; latencyMs: number }
  >;
  readonly buffer: { depth: number; capacity: number; fillFraction: number; shedding: boolean };
  readonly queue: { waitingCount: number; activeCount: number; dlqSize: number };
}

export async function getHealth(): Promise<{ httpStatus: number; body: HealthResponse }> {
  const res = await fetch(`${API_BASE_URL}/health`);
  const body = (await res.json()) as HealthResponse;
  return { httpStatus: res.status, body };
}

export interface IncidentSummaryDto {
  readonly id: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly state: WorkItemState;
  readonly title: string;
  readonly firstSignalAt: string;
  readonly signalCount: number;
  readonly updatedAt: string;
  readonly legalNextStates?: readonly WorkItemState[];
  readonly rca?: unknown;
}

export async function getIncident(
  id: string,
): Promise<{ status: number; body: IncidentSummaryDto & Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${encodeURIComponent(id)}`, {
    headers: await authHeaders(),
  });
  const body = (await res.json()) as IncidentSummaryDto & Record<string, unknown>;
  return { status: res.status, body };
}

/** `actor` is accepted for backward-compatible call sites but ignored by the server — the audit trail now records the authenticated caller's email (see api/routes/workitems.ts). */
export async function transitionIncident(
  id: string,
  toState: WorkItemState,
  actor: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  void actor;
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ toState }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export interface RcaInput {
  readonly actor: string;
  readonly incidentStartTime?: string;
  readonly incidentEndTime?: string;
  readonly rootCauseCategory?: string;
  readonly rootCauseDescription?: string;
  readonly fixApplied?: string;
  readonly preventionSteps?: string;
}

export async function submitRca(
  id: string,
  rca: RcaInput,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${encodeURIComponent(id)}/rca`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(rca),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export interface StateTransitionDto {
  readonly id: string;
  readonly workItemId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly actor: string;
  readonly occurredAt: string;
}

export async function getTransitions(
  id: string,
): Promise<{ status: number; items: readonly StateTransitionDto[] }> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/incidents/${encodeURIComponent(id)}/transitions`,
    { headers: await authHeaders() },
  );
  const body = (await res.json().catch(() => ({ items: [] }))) as { items?: StateTransitionDto[] };
  return { status: res.status, items: body.items ?? [] };
}

export interface ComponentHealthDto {
  readonly componentId: string;
  readonly windowSeconds: number;
  readonly recentSignalCount: number;
  readonly avgMttrMs: number | null;
  readonly openWorkItemsByState: Record<string, number>;
}

export async function getComponentHealth(
  componentId: string,
): Promise<{ status: number; body: ComponentHealthDto }> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/analytics/components/${encodeURIComponent(componentId)}`,
    { headers: await authHeaders() },
  );
  const body = (await res.json()) as ComponentHealthDto;
  return { status: res.status, body };
}

export interface MttrPointDto {
  readonly bucket: string;
  readonly value: string;
  readonly avgMttrMs: number;
  readonly rollingAvgMttrMs: number;
  readonly sampleCount: number;
}

export async function getMttrAnalytics(params: {
  from: string;
  to: string;
  interval: number;
  groupBy: "componentType" | "severity";
}): Promise<{ status: number; points: readonly MttrPointDto[] }> {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    interval: String(params.interval),
    groupBy: params.groupBy,
  });
  const res = await fetch(`${API_BASE_URL}/api/v1/analytics/mttr?${query.toString()}`, {
    headers: await authHeaders(),
  });
  const body = (await res.json().catch(() => ({ points: [] }))) as { points?: MttrPointDto[] };
  return { status: res.status, points: body.points ?? [] };
}

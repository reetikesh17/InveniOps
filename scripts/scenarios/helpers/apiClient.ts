// Thin wrapper around the real HTTP API — these scripts drive InveniOps
// exactly like any other external caller would (same posture as
// backend/tests/chaos/helpers/apiClient.ts), not through in-process
// shortcuts. That's the point: the evidence this produces (work items,
// signal counts, alert logs) is only meaningful if it went through the
// real ingestion → debounce → alerting pipeline.
import { sleep } from "./wait.js";

export type Severity = "P0" | "P1" | "P2" | "P3";
export type ComponentType = "API" | "MCP_HOST" | "CACHE" | "QUEUE" | "RDBMS" | "NOSQL";

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
  readonly retries: number;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Max attempts when the server responds 429 — a well-behaved client backs off and retries, it doesn't just fail. */
  readonly maxRateLimitRetries?: number;
}

export class ApiClient {
  private authToken: string | undefined;

  constructor(private readonly options: ApiClientOptions) {}

  /**
   * The incident transition/RCA routes below sit behind requireAuth (see
   * backend/src/api/app.ts) — signed up once per ApiClient instance and
   * cached, same posture as backend/tests/{e2e,chaos}/helpers/apiClient.ts.
   * Signal ingestion above stays unauthenticated on purpose (ingestion is
   * machine-to-machine — see app.ts's own comment) and needs no token.
   */
  private async ensureAuthToken(): Promise<string> {
    if (this.authToken) {
      return this.authToken;
    }
    const res = await fetch(`${this.options.baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        password: "scenario-script-password",
        name: "Scenario Script",
      }),
    });
    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      throw new Error(`scenario auth signup failed: ${res.status} ${JSON.stringify(body)}`);
    }
    this.authToken = body.token;
    return body.token;
  }

  /**
   * Posts a batch and retries on 429 honoring `Retry-After`, up to
   * `maxRateLimitRetries` attempts. This matters specifically for
   * `--speed` > 1: the scenario timeline compresses, but the backend's
   * real per-IP token bucket (default 50 capacity / 20 per second) does
   * not — a fast replay can genuinely trip it, and the honest response is
   * "retry like a real client would," not "loosen the rate limiter" or
   * "pretend it didn't happen."
   */
  async postSignals(signals: readonly SignalInput[]): Promise<IngestResult> {
    const maxRetries = this.options.maxRateLimitRetries ?? 10;
    let retries = 0;

    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(`${this.options.baseUrl}/api/v1/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signals),
      });

      if (res.status === 429) {
        if (attempt >= maxRetries) {
          throw new Error(
            `rate limited ${maxRetries} times in a row posting to ${this.options.baseUrl} — giving up`,
          );
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
        retries,
      };
    }
  }

  async getHealth(): Promise<{ httpStatus: number; body: HealthResponse }> {
    const res = await fetch(`${this.options.baseUrl}/health`);
    const body = (await res.json()) as HealthResponse;
    return { httpStatus: res.status, body };
  }

  /** `actor` is accepted for backward-compatible call sites but ignored by the server — the audit trail now records the authenticated caller's email (see backend/src/api/routes/workitems.ts). */
  async transition(
    workItemId: string,
    toState: "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED",
    actor: string,
  ): Promise<{ status: number; body: IncidentSummaryDto }> {
    void actor;
    const token = await this.ensureAuthToken();
    const res = await fetch(
      `${this.options.baseUrl}/api/v1/incidents/${encodeURIComponent(workItemId)}/transition`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toState }),
      },
    );
    const body = (await res.json()) as IncidentSummaryDto;
    return { status: res.status, body };
  }

  async submitRca(
    workItemId: string,
    rca: RcaSubmission,
  ): Promise<{
    status: number;
    body: IncidentSummaryDto & { mttrSeconds?: number };
    raw: unknown;
  }> {
    const token = await this.ensureAuthToken();
    const res = await fetch(
      `${this.options.baseUrl}/api/v1/incidents/${encodeURIComponent(workItemId)}/rca`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(rca),
      },
    );
    const raw = await res.json().catch(() => ({}));
    return { status: res.status, body: raw as IncidentSummaryDto & { mttrSeconds?: number }, raw };
  }
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

export interface IncidentSummaryDto {
  readonly id: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly state: "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";
  readonly title: string;
  readonly firstSignalAt: string;
  readonly signalCount: number;
  readonly updatedAt: string;
}

export interface RcaSubmission {
  readonly actor: string;
  readonly incidentStartTime: string;
  readonly incidentEndTime: string;
  readonly rootCauseCategory: string;
  readonly rootCauseDescription: string;
  readonly fixApplied: string;
  readonly preventionSteps: string;
}

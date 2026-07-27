// Thin wrappers around the real HTTP API — deliberately not importing any
// backend `src/` route code, since the whole point is exercising the
// process as an external caller would, the same way a chaos test that
// short-circuited through in-process function calls couldn't.
import { randomUUID } from "node:crypto";
import { API_BASE_URL } from "./testEnv.js";

export type Severity = "P0" | "P1" | "P2" | "P3";
export type ComponentType = "API" | "MCP_HOST" | "CACHE" | "QUEUE" | "RDBMS" | "NOSQL";

export interface SignalInput {
  readonly signalId?: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly rawPayload?: unknown;
  readonly occurredAt?: string;
}

export function makeSignal(overrides: Partial<SignalInput> = {}): SignalInput {
  const id = overrides.signalId ?? randomUUID();
  return {
    signalId: id,
    componentId: overrides.componentId ?? `CHAOS_COMPONENT_${id.slice(0, 8)}`,
    componentType: overrides.componentType ?? "API",
    severity: overrides.severity ?? "P2",
    rawPayload: overrides.rawPayload ?? { chaosTest: true },
    occurredAt: overrides.occurredAt ?? new Date().toISOString(),
  };
}

export interface IngestResult {
  readonly status: number;
  readonly body: { accepted?: number; dropped?: number; signalIds?: string[]; error?: string; message?: string };
  readonly durationMs: number;
}

// occurredAt is required by the real API (signalInputSchema has no
// .optional() on it) — filled in here so every call site doesn't have to
// remember it; SignalInput itself keeps it optional purely for call-site
// convenience.
function withOccurredAt(signal: SignalInput): SignalInput {
  return { ...signal, occurredAt: signal.occurredAt ?? new Date().toISOString() };
}

export async function postSignals(signals: SignalInput | readonly SignalInput[], timeoutMs = 10_000): Promise<IngestResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const normalized = Array.isArray(signals) ? signals.map(withOccurredAt) : withOccurredAt(signals as SignalInput);
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as IngestResult["body"];
    return { status: res.status, body, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthResponse {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly dependencies: Record<"postgres" | "mongo" | "redis" | "queue", { status: "up" | "down"; latencyMs: number }>;
  readonly buffer: { depth: number; capacity: number; fillFraction: number; shedding: boolean };
  readonly queue: { waitingCount: number; activeCount: number; dlqSize: number };
}

export async function getHealth(): Promise<{ httpStatus: number; body: HealthResponse }> {
  const res = await fetch(`${API_BASE_URL}/health`);
  const body = (await res.json()) as HealthResponse;
  return { httpStatus: res.status, body };
}

export async function getMetricsText(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/metrics`);
  return res.text();
}

export interface IncidentSummaryDto {
  readonly id: string;
  readonly componentId: string;
  readonly severity: string;
  readonly state: string;
  readonly signalCount: number;
}

export async function listActiveIncidents(limit = 50): Promise<{ status: number; items: IncidentSummaryDto[]; total: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents?limit=${limit}`);
  const body = (await res.json().catch(() => ({ items: [], total: 0 }))) as { items?: IncidentSummaryDto[]; total?: number };
  return { status: res.status, items: body.items ?? [], total: body.total ?? 0 };
}

export async function getIncident(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${encodeURIComponent(id)}`);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export async function transitionIncident(
  id: string,
  toState: string,
  actor: string,
  timeoutMs = 10_000,
): Promise<{ status: number; body: Record<string, unknown>; durationMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/incidents/${encodeURIComponent(id)}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toState, actor }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

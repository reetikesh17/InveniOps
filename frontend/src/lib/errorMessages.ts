import type { ApiErrorInfo } from "./api";

/**
 * One place that turns an ApiErrorInfo into operator-facing copy, so every
 * ErrorState across the app words the same failure the same way — and, in
 * particular, so a 503 (system under load / dependency unavailable) reads
 * distinctly from a network drop rather than collapsing into one generic
 * "something failed". Never surfaces a raw error/stack.
 */
export function friendlyErrorMessage(error: ApiErrorInfo, subject = "data"): string {
  switch (error.kind) {
    case "network":
      return `Can't reach the backend — it may be starting up or offline. Retrying automatically.`;
    case "timeout":
      return `The request for ${subject} timed out. The backend may be under load.`;
    case "unavailable":
      // 503 — the service is up but shedding/degraded (a dependency is down or
      // the ingestion buffer is saturated). Distinct from an outright outage.
      return `The system is under load right now and couldn't serve ${subject}. This usually clears on its own — try again shortly.`;
    case "not_found":
      return `That ${subject} couldn't be found.`;
    case "validation":
    case "invalid_rca":
      return error.message;
    case "conflict":
      return error.message;
    default:
      return `Couldn't load ${subject}.`;
  }
}

/** True when the failure is a transient load/outage condition worth auto-retrying, vs a client-side (4xx) problem. */
export function isTransient(error: ApiErrorInfo): boolean {
  return error.kind === "network" || error.kind === "timeout" || error.kind === "unavailable";
}

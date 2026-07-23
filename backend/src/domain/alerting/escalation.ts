import type { EscalationPolicy, Severity } from "./types.js";

// Keyed by the *reconciled* severity, not by component — escalation
// urgency is about how bad the final call is, not which component it came
// from, so this is shared rather than duplicated across every strategy.
// Numbers are illustrative defaults, easy to retune without touching any
// strategy: P0 pages immediately, P3 is fine to sit in an inbox for a while.
const ESCALATION_POLICIES: Readonly<Record<Severity, EscalationPolicy>> = {
  P0: { acknowledgeWithinMs: 5 * 60_000, escalateTo: "pagerduty" },
  P1: { acknowledgeWithinMs: 15 * 60_000, escalateTo: "slack" },
  P2: { acknowledgeWithinMs: 60 * 60_000, escalateTo: "email" },
  P3: { acknowledgeWithinMs: 4 * 60 * 60_000, escalateTo: "email" },
};

export function getEscalationPolicy(severity: Severity): EscalationPolicy {
  return ESCALATION_POLICIES[severity];
}

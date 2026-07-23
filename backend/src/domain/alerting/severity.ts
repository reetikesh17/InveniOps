import type { Severity } from "./types.js";

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Reconciles a strategy's severity floor against what the signal itself
 * reported, returning whichever is more severe (lower rank number).
 *
 * Rule: the floor is a minimum, never a cap. Component criticality is a
 * structural fact independent of any one signal — an RDBMS is a shared
 * dependency for everything downstream, so its floor is P0, and nothing
 * outranks P0 — reconcileSeverity("P0", anything) is always "P0". But a
 * normally-quiet component (Cache, floor P2) can still genuinely produce a
 * P0-worthy failure; silently clamping that down to the component's usual
 * baseline would suppress a real emergency. So: never let a signal
 * under-alert a critical component, and never let a component's calm
 * baseline swallow a signal that's actually screaming. Whichever of the
 * two is more urgent wins, in both directions.
 *
 * This is the only place this comparison is implemented — every strategy
 * calls it with its own floor rather than reimplementing the rule, so it
 * can't drift between strategies.
 */
export function reconcileSeverity(floor: Severity, reported: Severity): Severity {
  return SEVERITY_RANK[reported] < SEVERITY_RANK[floor] ? reported : floor;
}

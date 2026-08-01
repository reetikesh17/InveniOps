import { ComponentType, Severity } from "@prisma/client";

/**
 * Realistic per-component-type reported-severity mix for the in-process load
 * generator (POST /api/v1/signals/bulk-test).
 *
 * The modal severity for each type is that type's AlertStrategy
 * `severityFloor` (RDBMS P0, Cache P2, the rest P1 — see
 * src/domain/alerting/strategies/), with spread around it. This makes
 * generated data reflect the Strategy pattern's differentiation — RDBMS
 * incidents mostly surface P0, Cache mostly P2 — instead of the previous
 * uniform round-robin, which paired severities with component types at
 * random (a P0 landing on a Cache signal, etc.) and made the floors look
 * ignored in the dashboard.
 *
 * The off-modal tails are deliberate, not noise: they are exactly the cases
 * `reconcileSeverity` exists for. A Cache signal that draws P0 is a genuine
 * escalation that legitimately surfaces P0; an RDBMS signal that draws P2 is
 * an under-reported signal that the P0 floor lifts back to P0 on the alert.
 * Both directions of the reconciliation rule (docs/decisions/0006) become
 * visible in real generated traffic.
 *
 * Weights per type sum to 1.0.
 */
const SEVERITY_MIX: Readonly<Record<ComponentType, readonly (readonly [Severity, number])[]>> = {
  [ComponentType.RDBMS]: [
    [Severity.P0, 0.7],
    [Severity.P1, 0.22],
    [Severity.P2, 0.08],
  ],
  [ComponentType.API]: [
    [Severity.P0, 0.12],
    [Severity.P1, 0.5],
    [Severity.P2, 0.28],
    [Severity.P3, 0.1],
  ],
  [ComponentType.MCP_HOST]: [
    [Severity.P0, 0.12],
    [Severity.P1, 0.5],
    [Severity.P2, 0.28],
    [Severity.P3, 0.1],
  ],
  [ComponentType.NOSQL]: [
    [Severity.P0, 0.06],
    [Severity.P1, 0.46],
    [Severity.P2, 0.34],
    [Severity.P3, 0.14],
  ],
  [ComponentType.QUEUE]: [
    [Severity.P0, 0.05],
    [Severity.P1, 0.45],
    [Severity.P2, 0.35],
    [Severity.P3, 0.15],
  ],
  [ComponentType.CACHE]: [
    [Severity.P0, 0.05],
    [Severity.P1, 0.15],
    [Severity.P2, 0.5],
    [Severity.P3, 0.3],
  ],
};

/**
 * Draws a reported severity appropriate to the component type from the mix
 * above. `rng` is injectable (defaults to Math.random) so the distribution
 * is deterministically testable.
 */
export function pickSeverityForComponentType(
  componentType: ComponentType,
  rng: () => number = Math.random,
): Severity {
  const mix = SEVERITY_MIX[componentType];
  const roll = rng();
  let cumulative = 0;
  for (const [severity, weight] of mix) {
    cumulative += weight;
    if (roll < cumulative) {
      return severity;
    }
  }
  // Floating-point guard: rng() at exactly 1 (or rounding past the last
  // boundary) falls through to the last, most-severe-tail entry.
  return mix[mix.length - 1]![0];
}

/** Exposed for tests to assert the mix stays coherent (weights sum to 1, modal severity = the strategy floor). */
export function severityMixFor(
  componentType: ComponentType,
): readonly (readonly [Severity, number])[] {
  return SEVERITY_MIX[componentType];
}

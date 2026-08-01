import { describe, expect, it } from "vitest";
import { ComponentType, Severity } from "@prisma/client";
import {
  pickSeverityForComponentType,
  severityMixFor,
} from "../../../../src/api/routes/syntheticSeverity.js";
import { createDefaultAlertStrategyRegistry } from "../../../../src/domain/alerting/registry.js";

const ALL_TYPES = Object.values(ComponentType);
const registry = createDefaultAlertStrategyRegistry();

// A small deterministic LCG, so the distribution assertions below are stable
// across runs (no Math.random flakiness) while still exercising the full [0,1) range.
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function modalSeverity(mix: readonly (readonly [Severity, number])[]): Severity {
  return [...mix].sort((a, b) => b[1] - a[1])[0]![0];
}

describe("syntheticSeverity mix", () => {
  describe.each(ALL_TYPES)("%s", (type) => {
    const mix = severityMixFor(type);

    it("has weights summing to 1", () => {
      expect(mix.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(1, 6);
    });

    it("has its modal severity equal to the component's alert-strategy floor", () => {
      // This is the whole point of the fix: generated data's dominant
      // severity per type matches the Strategy pattern's floor, so RDBMS
      // surfaces P0, Cache surfaces P2, etc. Tied to the real registry so a
      // future floor change that isn't mirrored here fails loudly.
      expect(modalSeverity(mix)).toBe(registry.resolve(type).severityFloor);
    });
  });
});

describe("pickSeverityForComponentType", () => {
  it("selects the band the rng falls into (RDBMS: P0 up to 0.70, then P1, then P2)", () => {
    expect(pickSeverityForComponentType(ComponentType.RDBMS, () => 0)).toBe(Severity.P0);
    expect(pickSeverityForComponentType(ComponentType.RDBMS, () => 0.69)).toBe(Severity.P0);
    expect(pickSeverityForComponentType(ComponentType.RDBMS, () => 0.8)).toBe(Severity.P1);
    expect(pickSeverityForComponentType(ComponentType.RDBMS, () => 0.95)).toBe(Severity.P2);
  });

  it("only ever returns severities present in the type's mix", () => {
    const rng = makeRng(7);
    for (const type of ALL_TYPES) {
      const allowed = new Set(severityMixFor(type).map(([severity]) => severity));
      for (let i = 0; i < 500; i += 1) {
        expect(allowed.has(pickSeverityForComponentType(type, rng))).toBe(true);
      }
    }
  });

  it("the generator's even quantile spread across a type's components is modal at the type's floor", () => {
    // Mirrors how generateSyntheticSignal assigns each synthetic component a
    // stable severity: rank r of N -> quantile (r + 0.5) / N. Spread across a
    // type's components this must reproduce the strategy's floor as the modal
    // severity — RDBMS mostly P0, Cache mostly P2 — which is what makes
    // work-item severity (and the dashboard) differentiate by component type.
    const RANKS = 20;
    for (const type of ALL_TYPES) {
      const counts: Record<string, number> = {};
      for (let rank = 0; rank < RANKS; rank += 1) {
        const severity = pickSeverityForComponentType(type, () => (rank + 0.5) / RANKS);
        counts[severity] = (counts[severity] ?? 0) + 1;
      }
      const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
      expect(modal).toBe(registry.resolve(type).severityFloor);
    }
  });

  it("produces a type-differentiated distribution: RDBMS dominated by P0, Cache by P2", () => {
    const rng = makeRng(42);
    const tally = (type: ComponentType): Record<string, number> => {
      const counts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
      for (let i = 0; i < 4000; i += 1) {
        counts[pickSeverityForComponentType(type, rng)] += 1;
      }
      return counts;
    };

    const rdbms = tally(ComponentType.RDBMS);
    const cache = tally(ComponentType.CACHE);

    // RDBMS: P0 is the clear majority and P3 never appears (not in its mix).
    expect(rdbms.P0).toBeGreaterThan(rdbms.P1 + rdbms.P2);
    expect(rdbms.P3).toBe(0);
    // Cache: P2 dominates and P0 is rare — the opposite skew from RDBMS.
    expect(cache.P2).toBeGreaterThan(cache.P0 + cache.P1);
    expect(cache.P0).toBeLessThan(cache.P2);
  });
});

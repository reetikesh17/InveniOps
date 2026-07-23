import { describe, expect, it } from "vitest";
import { RdbmsAlertStrategy } from "../../../../src/domain/alerting/strategies/rdbmsStrategy.js";
import { NosqlAlertStrategy } from "../../../../src/domain/alerting/strategies/nosqlStrategy.js";
import { CacheAlertStrategy } from "../../../../src/domain/alerting/strategies/cacheStrategy.js";
import { ApiAlertStrategy } from "../../../../src/domain/alerting/strategies/apiStrategy.js";
import { McpHostAlertStrategy } from "../../../../src/domain/alerting/strategies/mcpHostStrategy.js";
import { QueueAlertStrategy } from "../../../../src/domain/alerting/strategies/queueStrategy.js";
import { DefaultAlertStrategy } from "../../../../src/domain/alerting/strategies/defaultStrategy.js";
import { getEscalationPolicy } from "../../../../src/domain/alerting/escalation.js";
import type { AlertContext, AlertStrategy, Severity } from "../../../../src/domain/alerting/types.js";

function makeContext(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    componentId: "comp-1",
    componentType: "irrelevant-to-this-test",
    reportedSeverity: "P2",
    signalCount: 5,
    firstSignalAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const ALL_STRATEGIES: readonly AlertStrategy[] = [
  new RdbmsAlertStrategy(),
  new NosqlAlertStrategy(),
  new CacheAlertStrategy(),
  new ApiAlertStrategy(),
  new McpHostAlertStrategy(),
  new QueueAlertStrategy(),
  new DefaultAlertStrategy(),
];

describe("built-in strategy severity reconciliation", () => {
  it("RDBMS (floor P0) is never downgraded by a less severe report", () => {
    const alert = new RdbmsAlertStrategy().buildAlert(makeContext({ reportedSeverity: "P3" }));
    expect(alert.severity).toBe("P0");
  });

  it("CACHE (floor P2) is upgraded when the report is more severe", () => {
    const alert = new CacheAlertStrategy().buildAlert(makeContext({ reportedSeverity: "P0" }));
    expect(alert.severity).toBe("P0");
  });

  it("CACHE (floor P2) enforces its floor against a less severe report", () => {
    const alert = new CacheAlertStrategy().buildAlert(makeContext({ reportedSeverity: "P3" }));
    expect(alert.severity).toBe("P2");
  });

  it("every strategy's escalation is derived from the reconciled severity, not the raw reported severity", () => {
    for (const strategy of ALL_STRATEGIES) {
      // A report far above the floor forces reconciliation to actually change something.
      const alert = strategy.buildAlert(makeContext({ reportedSeverity: "P0" }));
      expect(alert.severity).toBe("P0");
      expect(alert.escalation).toEqual(getEscalationPolicy("P0"));
    }
  });
});

describe("built-in strategy rendering", () => {
  it("each strategy renders a distinct title for the same input — not shared boilerplate", () => {
    const titles = ALL_STRATEGIES.map((strategy) => strategy.buildAlert(makeContext()).title);
    expect(new Set(titles).size).toBe(ALL_STRATEGIES.length);
  });

  it("each strategy renders a distinct body for the same input", () => {
    const bodies = ALL_STRATEGIES.map((strategy) => strategy.buildAlert(makeContext()).body);
    expect(new Set(bodies).size).toBe(ALL_STRATEGIES.length);
  });

  it("channels are strategy-specific, not a single shared default", () => {
    const channelSets = ALL_STRATEGIES.map((strategy) => strategy.buildAlert(makeContext()).channels.join(","));
    expect(new Set(channelSets).size).toBeGreaterThan(1);
  });
});

describe("DefaultAlertStrategy", () => {
  it("names the unrecognized component type in its output rather than silently guessing", () => {
    const alert = new DefaultAlertStrategy().buildAlert(makeContext({ componentType: "SOME_NEW_THING" }));
    expect(alert.title).toContain("SOME_NEW_THING");
    expect(alert.body).toContain("SOME_NEW_THING");
  });

  it("floor P2, same reconciliation rule as every other strategy", () => {
    const upgraded = new DefaultAlertStrategy().buildAlert(makeContext({ reportedSeverity: "P0" satisfies Severity }));
    expect(upgraded.severity).toBe("P0");
    const flooredAt = new DefaultAlertStrategy().buildAlert(makeContext({ reportedSeverity: "P3" satisfies Severity }));
    expect(flooredAt.severity).toBe("P2");
  });
});

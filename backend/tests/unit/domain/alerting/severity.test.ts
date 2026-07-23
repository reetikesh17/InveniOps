import { describe, expect, it } from "vitest";
import { reconcileSeverity } from "../../../../src/domain/alerting/severity.js";
import type { Severity } from "../../../../src/domain/alerting/types.js";

const ALL_SEVERITIES: readonly Severity[] = ["P0", "P1", "P2", "P3"];

describe("reconcileSeverity", () => {
  it("keeps the floor when the reported severity is less severe", () => {
    expect(reconcileSeverity("P0", "P3")).toBe("P0");
    expect(reconcileSeverity("P1", "P2")).toBe("P1");
  });

  it("upgrades to the reported severity when it's more severe than the floor", () => {
    expect(reconcileSeverity("P2", "P0")).toBe("P0");
    expect(reconcileSeverity("P3", "P1")).toBe("P1");
  });

  it("returns the shared value when floor and reported agree", () => {
    for (const severity of ALL_SEVERITIES) {
      expect(reconcileSeverity(severity, severity)).toBe(severity);
    }
  });

  it("a P0 floor is never downgraded — nothing outranks P0", () => {
    for (const reported of ALL_SEVERITIES) {
      expect(reconcileSeverity("P0", reported)).toBe("P0");
    }
  });

  it("a P3 floor is never the winner unless the report is also P3 — everything else is more severe", () => {
    for (const reported of ALL_SEVERITIES) {
      expect(reconcileSeverity("P3", reported)).toBe(reported);
    }
  });
});

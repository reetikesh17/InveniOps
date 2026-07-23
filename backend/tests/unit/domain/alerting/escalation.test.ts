import { describe, expect, it } from "vitest";
import { getEscalationPolicy } from "../../../../src/domain/alerting/escalation.js";

describe("getEscalationPolicy", () => {
  it("P0 escalates fastest, to pagerduty", () => {
    expect(getEscalationPolicy("P0")).toEqual({ acknowledgeWithinMs: 5 * 60_000, escalateTo: "pagerduty" });
  });

  it("P1 escalates to slack", () => {
    expect(getEscalationPolicy("P1")).toEqual({ acknowledgeWithinMs: 15 * 60_000, escalateTo: "slack" });
  });

  it("P2 escalates to email", () => {
    expect(getEscalationPolicy("P2")).toEqual({ acknowledgeWithinMs: 60 * 60_000, escalateTo: "email" });
  });

  it("P3 escalates slowest, to email", () => {
    expect(getEscalationPolicy("P3")).toEqual({ acknowledgeWithinMs: 4 * 60 * 60_000, escalateTo: "email" });
  });

  it("escalation urgency is strictly ordered P0 < P1 < P2 < P3", () => {
    const timings = (["P0", "P1", "P2", "P3"] as const).map((severity) => getEscalationPolicy(severity).acknowledgeWithinMs);
    expect(timings).toEqual([...timings].sort((a, b) => a - b));
    expect(new Set(timings).size).toBe(4); // strictly increasing, no ties
  });
});

import { describe, expect, it } from "vitest";
import { calculateMttr } from "../../../../src/domain/rca/calculateMttr.js";

describe("calculateMttr", () => {
  it("computes whole seconds between first signal and RCA submission", () => {
    const firstSignalAt = new Date("2026-01-01T00:00:00.000Z");
    const rcaSubmittedAt = new Date("2026-01-01T01:00:00.000Z");
    expect(calculateMttr(firstSignalAt, rcaSubmittedAt)).toEqual({ ok: true, mttrSeconds: 3600 });
  });

  it("rounds sub-second differences to the nearest whole second", () => {
    const firstSignalAt = new Date("2026-01-01T00:00:00.000Z");
    const rcaSubmittedAt = new Date("2026-01-01T00:00:10.600Z");
    expect(calculateMttr(firstSignalAt, rcaSubmittedAt)).toEqual({ ok: true, mttrSeconds: 11 });
  });

  it("returns zero when submission is simultaneous with the first signal", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(calculateMttr(at, new Date(at))).toEqual({ ok: true, mttrSeconds: 0 });
  });

  it("returns an explicit clock-skew failure, not a negative number, when submission precedes the first signal", () => {
    const firstSignalAt = new Date("2026-01-01T01:00:00.000Z");
    const rcaSubmittedAt = new Date("2026-01-01T00:00:00.000Z");
    const result = calculateMttr(firstSignalAt, rcaSubmittedAt);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("clock_skew");
      expect(result.message).toContain("before");
    }
  });

  it("treats a one-millisecond skew the same as any other negative duration", () => {
    const firstSignalAt = new Date("2026-01-01T00:00:00.001Z");
    const rcaSubmittedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(calculateMttr(firstSignalAt, rcaSubmittedAt).ok).toBe(false);
  });
});

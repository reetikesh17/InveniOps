import { describe, expect, it } from "vitest";
import { toBucketSpec } from "../../../../src/repositories/metrics/bucketing.js";

describe("toBucketSpec", () => {
  it("picks the largest whole unit that divides the interval evenly", () => {
    expect(toBucketSpec(86_400)).toEqual({ unit: "day", binSize: 1 });
    expect(toBucketSpec(172_800)).toEqual({ unit: "day", binSize: 2 });
    expect(toBucketSpec(3_600)).toEqual({ unit: "hour", binSize: 1 });
    expect(toBucketSpec(7_200)).toEqual({ unit: "hour", binSize: 2 });
    expect(toBucketSpec(60)).toEqual({ unit: "minute", binSize: 1 });
    expect(toBucketSpec(300)).toEqual({ unit: "minute", binSize: 5 });
  });

  it("falls back to seconds when nothing larger divides evenly", () => {
    expect(toBucketSpec(90)).toEqual({ unit: "second", binSize: 90 });
    expect(toBucketSpec(1)).toEqual({ unit: "second", binSize: 1 });
  });

  it("rejects non-positive or non-integer intervals", () => {
    expect(() => toBucketSpec(0)).toThrow();
    expect(() => toBucketSpec(-60)).toThrow();
    expect(() => toBucketSpec(1.5)).toThrow();
  });
});

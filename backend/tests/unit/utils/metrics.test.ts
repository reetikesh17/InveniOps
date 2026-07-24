import { describe, expect, it } from "vitest";
import { Severity } from "@prisma/client";
import {
  Histogram,
  createSeverityCounters,
  createQueueMetricsRecorder,
  createAlertMetricsRecorder,
  createThroughputCounter,
  formatConsoleLine,
  E2E_LATENCY_BUCKETS_MS,
} from "../../../src/utils/metrics.js";

describe("Histogram", () => {
  it("buckets are cumulative (Prometheus 'le' convention) and never reset", () => {
    const histogram = new Histogram([10, 100]);
    histogram.observe(5); // <= 10 and <= 100
    histogram.observe(50); // <= 100 only
    histogram.observe(500); // neither bucket, but counts toward sum/count (+Inf)

    const snapshot = histogram.snapshot();
    expect(snapshot.cumulativeCounts).toEqual([1, 2]); // le=10 -> 1, le=100 -> 1+1=2
    expect(snapshot.count).toBe(3);
    expect(snapshot.sum).toBe(555);
  });

  it("a value exactly on a boundary is included in that boundary's bucket", () => {
    const histogram = new Histogram([10]);
    histogram.observe(10);
    expect(histogram.snapshot().cumulativeCounts).toEqual([1]);
  });
});

describe("SeverityCounters", () => {
  it("tracks received and accepted independently, cumulative across calls", () => {
    const counters = createSeverityCounters();
    counters.recordReceived(Severity.P0);
    counters.recordReceived(Severity.P0);
    counters.recordReceived(Severity.P1);
    counters.recordAccepted(Severity.P0);

    const snapshot = counters.snapshot();
    expect(snapshot.received[Severity.P0]).toBe(2);
    expect(snapshot.received[Severity.P1]).toBe(1);
    expect(snapshot.accepted[Severity.P0]).toBe(1);
    expect(snapshot.accepted[Severity.P1]).toBe(0);
  });

  it("snapshot() does not reset — repeated calls return the same accumulated totals", () => {
    const counters = createSeverityCounters();
    counters.recordReceived(Severity.P2, 5);
    counters.snapshot();
    const second = counters.snapshot();
    expect(second.received[Severity.P2]).toBe(5);
  });
});

describe("QueueMetricsRecorder", () => {
  it("reset() computes average/p50/p99 from this period's samples, then clears them", () => {
    const recorder = createQueueMetricsRecorder();
    for (const latency of [10, 20, 30, 40, 100]) {
      recorder.recordJobProcessed(latency);
    }
    recorder.recordJobFailed();

    const snapshot = recorder.reset();
    expect(snapshot.jobsProcessed).toBe(5);
    expect(snapshot.jobsFailed).toBe(1);
    expect(snapshot.averageLatencyMs).toBe(40);
    expect(snapshot.p50LatencyMs).toBe(30);
    expect(snapshot.p99LatencyMs).toBe(100);

    const secondSnapshot = recorder.reset();
    expect(secondSnapshot.jobsProcessed).toBe(0);
    expect(secondSnapshot.p50LatencyMs).toBeNull();
  });

  it("cumulative() never resets, independent of how many times reset() has been called", () => {
    const recorder = createQueueMetricsRecorder();
    recorder.recordJobProcessed(10);
    recorder.reset();
    recorder.recordJobProcessed(20);
    recorder.recordJobFailed();

    expect(recorder.cumulative()).toEqual({ jobsProcessedTotal: 2, jobsFailedTotal: 1 });
  });

  it("latencyHistogram() accumulates every recorded latency, unaffected by reset()", () => {
    const recorder = createQueueMetricsRecorder();
    recorder.recordJobProcessed(5);
    recorder.reset();
    recorder.recordJobProcessed(5);

    const histogram = recorder.latencyHistogram();
    expect(histogram.count).toBe(2);
    expect(histogram.boundariesMs).toEqual(E2E_LATENCY_BUCKETS_MS);
  });
});

describe("AlertMetricsRecorder", () => {
  it("snapshot() reports cumulative per-channel counts and never resets", () => {
    const recorder = createAlertMetricsRecorder();
    recorder.recordDeliverySuccess("slack");
    recorder.recordDeliverySuccess("slack");
    recorder.recordDeliveryFailure("pagerduty");
    recorder.recordEscalation();

    const first = recorder.snapshot();
    expect(first.byChannel["slack"]).toEqual({ delivered: 2, failed: 0 });
    expect(first.byChannel["pagerduty"]).toEqual({ delivered: 0, failed: 1 });
    expect(first.escalationsTriggered).toBe(1);

    const second = recorder.snapshot();
    expect(second).toEqual(first);
  });
});

describe("ThroughputCounter", () => {
  it("reset() returns the delta and zeroes the counter", () => {
    const counter = createThroughputCounter();
    counter.increment(5);
    counter.increment(3);
    expect(counter.reset()).toBe(8);
    expect(counter.reset()).toBe(0);
  });
});

describe("formatConsoleLine", () => {
  it("renders a single line containing every required field, human-readable", () => {
    const line = formatConsoleLine({
      time: new Date("2026-01-01T14:32:05.000Z"),
      signalsPerSecond: 842.4,
      bufferFillFraction: 0.123,
      queueDepth: 3,
      activeWorkItems: 47,
      dropsThisTick: 0,
      p50LatencyMs: 38,
      p99LatencyMs: 210,
    });

    expect(line.split("\n")).toHaveLength(1); // one line, not a JSON blob
    expect(line).toContain("14:32:05");
    expect(line).toContain("842.4/s");
    expect(line).toContain("buffer 12.3%");
    expect(line).toContain("queue depth 3");
    expect(line).toContain("active items 47");
    expect(line).toContain("drops 0");
    expect(line).toContain("p50 38ms");
    expect(line).toContain("p99 210ms");
  });

  it("renders 'n/a' rather than throwing when active work items or latency percentiles are unavailable", () => {
    const line = formatConsoleLine({
      time: new Date(),
      signalsPerSecond: 0,
      bufferFillFraction: 0,
      queueDepth: 0,
      activeWorkItems: null,
      dropsThisTick: 0,
      p50LatencyMs: null,
      p99LatencyMs: null,
    });

    expect(line).toContain("active items n/a");
    expect(line).toContain("p50 n/a");
    expect(line).toContain("p99 n/a");
  });
});

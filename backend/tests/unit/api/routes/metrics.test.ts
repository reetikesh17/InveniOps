import { describe, expect, it } from "vitest";
import { Severity, WorkItemStatus } from "@prisma/client";
import { renderPrometheusMetrics, type MetricsSnapshotInput } from "../../../../src/api/routes/metrics.js";
import { E2E_LATENCY_BUCKETS_MS } from "../../../../src/utils/metrics.js";

function zeroBySeverity(): Record<Severity, number> {
  return { [Severity.P0]: 0, [Severity.P1]: 0, [Severity.P2]: 0, [Severity.P3]: 0 };
}

function zeroDropReasons(): Record<"shed_ceiling" | "hard_capacity" | "sink_failure", number> {
  return { shed_ceiling: 0, hard_capacity: 0, sink_failure: 0 };
}

function makeSnapshot(overrides: Partial<MetricsSnapshotInput> = {}): MetricsSnapshotInput {
  return {
    signalCounters: { received: { ...zeroBySeverity(), [Severity.P1]: 10 }, accepted: { ...zeroBySeverity(), [Severity.P1]: 9 } },
    droppedBySeverityAndReason: {
      [Severity.P0]: zeroDropReasons(),
      [Severity.P1]: { ...zeroDropReasons(), shed_ceiling: 1 },
      [Severity.P2]: zeroDropReasons(),
      [Severity.P3]: zeroDropReasons(),
    },
    bufferDepthBySeverity: zeroBySeverity(),
    bufferFillFraction: 0.25,
    queueDepth: { waitingCount: 2, activeCount: 1, dlqSize: 0 },
    queueJobsCumulative: { jobsProcessedTotal: 100, jobsFailedTotal: 3 },
    workItemsByState: { [WorkItemStatus.OPEN]: 5, [WorkItemStatus.CLOSED]: 20 },
    alertsByChannel: { slack: { delivered: 8, failed: 1 }, console: { delivered: 9, failed: 0 } },
    escalationsTriggered: 2,
    latencyHistogram: {
      boundariesMs: E2E_LATENCY_BUCKETS_MS,
      cumulativeCounts: E2E_LATENCY_BUCKETS_MS.map(() => 0),
      sum: 0,
      count: 0,
    },
    ...overrides,
  };
}

// A line is either blank, a "# HELP"/"# TYPE" comment, or "metric_name{labels} value".
const SAMPLE_LINE = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?\s+-?[0-9]+(\.[0-9]+)?$/;

function assertValidPrometheusText(text: string): void {
  expect(text.endsWith("\n")).toBe(true);
  const lines = text.split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    const isComment = line.startsWith("# HELP ") || line.startsWith("# TYPE ");
    expect(isComment || SAMPLE_LINE.test(line), `not a valid HELP/TYPE/sample line: ${JSON.stringify(line)}`).toBe(true);
  }
}

describe("renderPrometheusMetrics", () => {
  it("produces text that parses as valid Prometheus exposition format", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    assertValidPrometheusText(text);
  });

  it("emits every metric name with a HELP and a TYPE line", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    for (const name of [
      "ims_signals_received_total",
      "ims_signals_accepted_total",
      "ims_signals_dropped_total",
      "ims_buffer_depth",
      "ims_buffer_fill_ratio",
      "ims_queue_depth",
      "ims_queue_dlq_size",
      "ims_queue_jobs_total",
      "ims_work_items",
      "ims_alerts_total",
      "ims_signal_e2e_latency_ms",
    ]) {
      expect(text).toContain(`# HELP ${name} `);
      expect(text).toContain(`# TYPE ${name} `);
    }
  });

  it("renders received/accepted signal counts by severity", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    expect(text).toContain(`ims_signals_received_total{severity="P1"} 10`);
    expect(text).toContain(`ims_signals_accepted_total{severity="P1"} 9`);
  });

  it("renders dropped signals cross-tabulated by severity and reason", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    expect(text).toContain(`ims_signals_dropped_total{severity="P1",reason="shed_ceiling"} 1`);
    expect(text).toContain(`ims_signals_dropped_total{severity="P0",reason="hard_capacity"} 0`);
  });

  it("renders queue depth by state, DLQ size, and cumulative job outcomes", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    expect(text).toContain(`ims_queue_depth{state="waiting"} 2`);
    expect(text).toContain(`ims_queue_depth{state="active"} 1`);
    expect(text).toContain(`ims_queue_dlq_size 0`);
    expect(text).toContain(`ims_queue_jobs_total{outcome="processed"} 100`);
    expect(text).toContain(`ims_queue_jobs_total{outcome="failed"} 3`);
  });

  it("renders all four work item states even when a state has zero work items", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    expect(text).toContain(`ims_work_items{state="OPEN"} 5`);
    expect(text).toContain(`ims_work_items{state="INVESTIGATING"} 0`);
    expect(text).toContain(`ims_work_items{state="RESOLVED"} 0`);
    expect(text).toContain(`ims_work_items{state="CLOSED"} 20`);
  });

  it("renders alert counts by channel and outcome", () => {
    const text = renderPrometheusMetrics(makeSnapshot());
    expect(text).toContain(`ims_alerts_total{channel="slack",outcome="delivered"} 8`);
    expect(text).toContain(`ims_alerts_total{channel="slack",outcome="failed"} 1`);
    expect(text).toContain(`ims_escalations_triggered_total 2`);
  });

  it("renders the e2e latency histogram with cumulative buckets, +Inf, sum, and count", () => {
    const text = renderPrometheusMetrics(
      makeSnapshot({
        latencyHistogram: { boundariesMs: [10, 100], cumulativeCounts: [1, 3], sum: 250, count: 4 },
      }),
    );
    expect(text).toContain(`ims_signal_e2e_latency_ms_bucket{le="10"} 1`);
    expect(text).toContain(`ims_signal_e2e_latency_ms_bucket{le="100"} 3`);
    expect(text).toContain(`ims_signal_e2e_latency_ms_bucket{le="+Inf"} 4`);
    expect(text).toContain(`ims_signal_e2e_latency_ms_sum 250`);
    expect(text).toContain(`ims_signal_e2e_latency_ms_count 4`);
  });
});

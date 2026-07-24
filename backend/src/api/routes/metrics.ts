import { Router, type NextFunction, type Request, type Response } from "express";
import { Severity, WorkItemStatus } from "@prisma/client";
import { prisma } from "../../repositories/clients.js";
import { PostgresWorkItemRepository } from "../../repositories/postgres/index.js";
import type { DropReason } from "../../services/ingestion/buffer.js";
import { signalBuffer } from "../../services/ingestion/signalBufferInstance.js";
import { signalCounters, E2E_LATENCY_BUCKETS_MS, type HistogramSnapshot, type SeverityCountersSnapshot } from "../../utils/metrics.js";
import { alertMetrics } from "../../services/alerting/alertingInstance.js";
import { getWorkerRuntimeRefs } from "../../services/observability/runtimeRefs.js";
import { queueDepthProbe, type QueueDepthSnapshot } from "../../services/observability/healthProbeInstance.js";

const SEVERITIES: readonly Severity[] = [Severity.P0, Severity.P1, Severity.P2, Severity.P3];
const DROP_REASONS: readonly DropReason[] = ["shed_ceiling", "hard_capacity", "sink_failure"];
const WORK_ITEM_STATES: readonly WorkItemStatus[] = [
  WorkItemStatus.OPEN,
  WorkItemStatus.INVESTIGATING,
  WorkItemStatus.RESOLVED,
  WorkItemStatus.CLOSED,
];

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels: Readonly<Record<string, string>>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return "";
  }
  return `{${keys.map((key) => `${key}="${escapeLabelValue(labels[key]!)}"`).join(",")}}`;
}

function sample(name: string, labels: Readonly<Record<string, string>>, value: number): string {
  return `${name}${formatLabels(labels)} ${value}`;
}

function metricBlock(name: string, help: string, type: "counter" | "gauge", lines: readonly string[]): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines].join("\n");
}

function renderHistogram(name: string, help: string, histogram: HistogramSnapshot): string {
  const bucketLines = histogram.boundariesMs.map((boundary, i) =>
    sample(`${name}_bucket`, { le: String(boundary) }, histogram.cumulativeCounts[i] ?? 0),
  );
  bucketLines.push(sample(`${name}_bucket`, { le: "+Inf" }, histogram.count));
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} histogram`,
    ...bucketLines,
    `${name}_sum ${histogram.sum}`,
    `${name}_count ${histogram.count}`,
  ].join("\n");
}

export interface MetricsSnapshotInput {
  readonly signalCounters: SeverityCountersSnapshot;
  readonly droppedBySeverityAndReason: Readonly<Record<Severity, Readonly<Record<DropReason, number>>>>;
  readonly bufferDepthBySeverity: Readonly<Record<Severity, number>>;
  readonly bufferFillFraction: number;
  readonly queueDepth: QueueDepthSnapshot;
  readonly queueJobsCumulative: { readonly jobsProcessedTotal: number; readonly jobsFailedTotal: number };
  readonly workItemsByState: Readonly<Record<string, number>>;
  readonly alertsByChannel: Readonly<Record<string, { readonly delivered: number; readonly failed: number }>>;
  readonly escalationsTriggered: number;
  readonly latencyHistogram: HistogramSnapshot;
}

/** Pure — builds the full Prometheus text-exposition body from an already-gathered snapshot. Independently unit-testable without any real infra. */
export function renderPrometheusMetrics(input: MetricsSnapshotInput): string {
  const blocks: string[] = [
    metricBlock(
      "ims_signals_received_total",
      "Signals received at the ingestion endpoint, by severity",
      "counter",
      SEVERITIES.map((s) => sample("ims_signals_received_total", { severity: s }, input.signalCounters.received[s])),
    ),
    metricBlock(
      "ims_signals_accepted_total",
      "Signals accepted into the ingestion buffer, by severity",
      "counter",
      SEVERITIES.map((s) => sample("ims_signals_accepted_total", { severity: s }, input.signalCounters.accepted[s])),
    ),
    metricBlock(
      "ims_signals_dropped_total",
      'Signals dropped by the ingestion buffer, by severity and reason (reason="shed_ceiling" is graceful shedding; hard_capacity/sink_failure are hard drops)',
      "counter",
      SEVERITIES.flatMap((s) =>
        DROP_REASONS.map((r) => sample("ims_signals_dropped_total", { severity: s, reason: r }, input.droppedBySeverityAndReason[s][r])),
      ),
    ),
    metricBlock(
      "ims_buffer_depth",
      "Current ingestion buffer depth, by severity",
      "gauge",
      SEVERITIES.map((s) => sample("ims_buffer_depth", { severity: s }, input.bufferDepthBySeverity[s])),
    ),
    metricBlock("ims_buffer_fill_ratio", "Current ingestion buffer fill fraction (0-1)", "gauge", [
      sample("ims_buffer_fill_ratio", {}, input.bufferFillFraction),
    ]),
    metricBlock("ims_queue_depth", "Current BullMQ queue depth, by job state", "gauge", [
      sample("ims_queue_depth", { state: "waiting" }, input.queueDepth.waitingCount),
      sample("ims_queue_depth", { state: "active" }, input.queueDepth.activeCount),
    ]),
    metricBlock("ims_queue_dlq_size", "Current dead-letter queue size", "gauge", [
      sample("ims_queue_dlq_size", {}, input.queueDepth.dlqSize),
    ]),
    metricBlock("ims_queue_jobs_total", "Cumulative BullMQ batch jobs, by outcome", "counter", [
      sample("ims_queue_jobs_total", { outcome: "processed" }, input.queueJobsCumulative.jobsProcessedTotal),
      sample("ims_queue_jobs_total", { outcome: "failed" }, input.queueJobsCumulative.jobsFailedTotal),
    ]),
    metricBlock(
      "ims_work_items",
      "Current work item count, by state",
      "gauge",
      WORK_ITEM_STATES.map((s) => sample("ims_work_items", { state: s }, input.workItemsByState[s] ?? 0)),
    ),
    metricBlock(
      "ims_alerts_total",
      "Cumulative alert dispatch attempts, by channel and outcome",
      "counter",
      Object.keys(input.alertsByChannel)
        .sort()
        .flatMap((channel) => {
          const counts = input.alertsByChannel[channel]!;
          return [
            sample("ims_alerts_total", { channel, outcome: "delivered" }, counts.delivered),
            sample("ims_alerts_total", { channel, outcome: "failed" }, counts.failed),
          ];
        }),
    ),
    metricBlock("ims_escalations_triggered_total", "Cumulative escalations triggered", "counter", [
      sample("ims_escalations_triggered_total", {}, input.escalationsTriggered),
    ]),
    renderHistogram(
      "ims_signal_e2e_latency_ms",
      "End-to-end latency from signal receipt to persistence, milliseconds",
      input.latencyHistogram,
    ),
  ];

  return `${blocks.join("\n\n")}\n`;
}

let workItemStore: PostgresWorkItemRepository | undefined;

/** Lazy, memoized — same reasoning as every other route module's getServices(): needs prisma connected, always true by the server's first request. */
function getWorkItemStore(): PostgresWorkItemRepository {
  if (!workItemStore) {
    workItemStore = new PostgresWorkItemRepository(prisma);
  }
  return workItemStore;
}

const EMPTY_HISTOGRAM: HistogramSnapshot = {
  boundariesMs: E2E_LATENCY_BUCKETS_MS,
  cumulativeCounts: E2E_LATENCY_BUCKETS_MS.map(() => 0),
  sum: 0,
  count: 0,
};

async function gatherMetricsSnapshot(): Promise<MetricsSnapshotInput> {
  const bufferStats = signalBuffer.getStats();
  const refs = getWorkerRuntimeRefs();
  // Reuses /health's cached queue-depth probe rather than querying BullMQ
  // live a second time — keeps the two endpoints' numbers consistent and
  // avoids adding another live-I/O path from a route handler.
  const queueDepth = queueDepthProbe.get();
  const queueJobsCumulative = refs?.metrics.cumulative() ?? { jobsProcessedTotal: 0, jobsFailedTotal: 0 };
  const latencyHistogram = refs?.metrics.latencyHistogram() ?? EMPTY_HISTOGRAM;
  // A live, indexed GROUP BY — cheap enough to run per scrape (typically
  // every 15-30s), unlike the dependency/queue checks this deliberately
  // avoids re-probing live on every request.
  const workItemsByState = await getWorkItemStore().countAllGroupedByState();
  const alertsSnapshot = alertMetrics.snapshot();

  return {
    signalCounters: signalCounters.snapshot(),
    droppedBySeverityAndReason: bufferStats.droppedBySeverityAndReason,
    bufferDepthBySeverity: bufferStats.depthBySeverity,
    bufferFillFraction: bufferStats.fillFraction,
    queueDepth,
    queueJobsCumulative,
    workItemsByState,
    alertsByChannel: alertsSnapshot.byChannel,
    escalationsTriggered: alertsSnapshot.escalationsTriggered,
    latencyHistogram,
  };
}

async function handleMetrics(res: Response): Promise<void> {
  const snapshot = await gatherMetricsSnapshot();
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(renderPrometheusMetrics(snapshot));
}

export const metricsRouter = Router();

metricsRouter.get("/", (_req: Request, res: Response, next: NextFunction): void => {
  handleMetrics(res).catch(next);
});

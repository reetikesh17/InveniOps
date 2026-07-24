import { Severity } from "@prisma/client";
import type { Logger } from "pino";
import type { BufferStats, DropReason } from "../services/ingestion/buffer.js";

export interface ThroughputCounter {
  increment(amount?: number): void;
  /** Returns the current count and resets it to zero. */
  reset(): number;
}

/**
 * Shared across the process: the signals route increments it on every
 * accepted signal, and the reporter started in src/index.ts reads it every
 * 5s. Kept alongside the factory (still used directly by tests) rather than
 * replacing it.
 */
export const throughputCounter: ThroughputCounter = createThroughputCounter();

export function createThroughputCounter(): ThroughputCounter {
  let count = 0;

  return {
    increment(amount = 1): void {
      count += amount;
    },
    reset(): number {
      const value = count;
      count = 0;
      return value;
    },
  };
}

// The most recently computed signals/sec figure, updated once per
// startMetricsReporter tick — GET /health's "current throughput" field
// reads this directly (zero I/O, always fast) rather than calling
// throughputCounter.reset() itself, which would corrupt the reporter's own
// delta bookkeeping.
let lastSignalsPerSecond = 0;

export function getLastSignalsPerSecond(): number {
  return lastSignalsPerSecond;
}

/**
 * Cumulative (never reset) counters for signals received at the ingestion
 * endpoint and accepted into the buffer, broken down by severity — GET
 * /metrics. Deliberately separate from throughputCounter, which stays a
 * simple delta-since-last-read total feeding only the console line.
 */
export interface SeverityCountersSnapshot {
  readonly received: Readonly<Record<Severity, number>>;
  readonly accepted: Readonly<Record<Severity, number>>;
}

export interface SeverityCounters {
  recordReceived(severity: Severity, amount?: number): void;
  recordAccepted(severity: Severity, amount?: number): void;
  snapshot(): SeverityCountersSnapshot;
}

export const signalCounters: SeverityCounters = createSeverityCounters();

function zeroBySeverity(): Record<Severity, number> {
  return { [Severity.P0]: 0, [Severity.P1]: 0, [Severity.P2]: 0, [Severity.P3]: 0 };
}

export function createSeverityCounters(): SeverityCounters {
  const received = zeroBySeverity();
  const accepted = zeroBySeverity();

  return {
    recordReceived(severity: Severity, amount = 1): void {
      received[severity] += amount;
    },
    recordAccepted(severity: Severity, amount = 1): void {
      accepted[severity] += amount;
    },
    snapshot(): SeverityCountersSnapshot {
      return { received: { ...received }, accepted: { ...accepted } };
    },
  };
}

/**
 * Fixed-bucket cumulative histogram, Prometheus "le" convention: each
 * bucket counts every observation less-than-or-equal-to its boundary, so
 * bucket[i] always includes everything bucket[i-1] does. Never reset —
 * that's what makes it a valid Prometheus histogram (Prometheus computes
 * rates/quantiles itself from repeated scrapes of the cumulative counts).
 */
export interface HistogramSnapshot {
  readonly boundariesMs: readonly number[];
  readonly cumulativeCounts: readonly number[];
  readonly sum: number;
  readonly count: number;
}

export class Histogram {
  private readonly counts: number[];
  private total = 0;
  private sumMs = 0;

  constructor(private readonly boundariesMs: readonly number[]) {
    this.counts = new Array<number>(boundariesMs.length).fill(0);
  }

  observe(valueMs: number): void {
    this.total += 1;
    this.sumMs += valueMs;
    for (let i = 0; i < this.boundariesMs.length; i += 1) {
      if (valueMs <= this.boundariesMs[i]!) {
        this.counts[i] = (this.counts[i] ?? 0) + 1;
      }
    }
  }

  snapshot(): HistogramSnapshot {
    return { boundariesMs: this.boundariesMs, cumulativeCounts: [...this.counts], sum: this.sumMs, count: this.total };
  }
}

export const E2E_LATENCY_BUCKETS_MS: readonly number[] = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Per-tick job processed/failed counts, average/p50/p99 end-to-end
 * latency (signal receipt -> persisted) for the console reporter — reset
 * on each read, same "delta since last read" posture as ThroughputCounter.
 */
export interface QueueMetricsSnapshot {
  readonly jobsProcessed: number;
  readonly jobsFailed: number;
  readonly averageLatencyMs: number | null;
  readonly p50LatencyMs: number | null;
  readonly p99LatencyMs: number | null;
}

/** Cumulative since process start — GET /metrics. */
export interface QueueMetricsCumulative {
  readonly jobsProcessedTotal: number;
  readonly jobsFailedTotal: number;
}

export interface QueueMetricsRecorder {
  recordJobProcessed(latencyMs: number): void;
  recordJobFailed(): void;
  /** Returns the accumulated counts/percentiles since the last call and resets them to zero. */
  reset(): QueueMetricsSnapshot;
  cumulative(): QueueMetricsCumulative;
  latencyHistogram(): HistogramSnapshot;
}

function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) {
    return null;
  }
  const index = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[index] ?? null;
}

export function createQueueMetricsRecorder(): QueueMetricsRecorder {
  let jobsProcessed = 0;
  let jobsFailed = 0;
  let totalLatencyMs = 0;
  let jobsProcessedTotal = 0;
  let jobsFailedTotal = 0;
  let samples: number[] = [];
  const histogram = new Histogram(E2E_LATENCY_BUCKETS_MS);

  return {
    recordJobProcessed(latencyMs: number): void {
      jobsProcessed += 1;
      totalLatencyMs += latencyMs;
      samples.push(latencyMs);
      jobsProcessedTotal += 1;
      histogram.observe(latencyMs);
    },
    recordJobFailed(): void {
      jobsFailed += 1;
      jobsFailedTotal += 1;
    },
    reset(): QueueMetricsSnapshot {
      const sorted = [...samples].sort((a, b) => a - b);
      const snapshot: QueueMetricsSnapshot = {
        jobsProcessed,
        jobsFailed,
        averageLatencyMs: jobsProcessed > 0 ? totalLatencyMs / jobsProcessed : null,
        p50LatencyMs: percentile(sorted, 0.5),
        p99LatencyMs: percentile(sorted, 0.99),
      };
      jobsProcessed = 0;
      jobsFailed = 0;
      totalLatencyMs = 0;
      samples = [];
      return snapshot;
    },
    cumulative(): QueueMetricsCumulative {
      return { jobsProcessedTotal, jobsFailedTotal };
    },
    latencyHistogram(): HistogramSnapshot {
      return histogram.snapshot();
    },
  };
}

/**
 * Point-in-time queue depth/DLQ size (live BullMQ counts) plus the raw
 * processed/failed counts and latency stats accumulated since the last
 * call — deliberately raw counts, not per-second rates: this function
 * doesn't know the reporting interval, the reporter does.
 */
export interface QueueReportSnapshot {
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly dlqSize: number;
  readonly jobsProcessed: number;
  readonly jobsFailed: number;
  readonly averageEndToEndLatencyMs: number | null;
  readonly p50LatencyMs: number | null;
  readonly p99LatencyMs: number | null;
}

/**
 * Per-channel delivered/failed counts plus a running escalation-fired
 * total — cumulative since process start (GET /metrics only consumer now
 * that the console line no longer breaks down alerts; see
 * startMetricsReporter). Kept per-channel (not a single aggregate) since
 * "which channel is failing" is the actionable signal here.
 */
export interface AlertChannelCounts {
  readonly delivered: number;
  readonly failed: number;
}

export interface AlertMetricsSnapshot {
  readonly byChannel: Readonly<Record<string, AlertChannelCounts>>;
  readonly escalationsTriggered: number;
}

export interface AlertMetricsRecorder {
  recordDeliverySuccess(channel: string): void;
  recordDeliveryFailure(channel: string): void;
  recordEscalation(): void;
  snapshot(): AlertMetricsSnapshot;
}

export function createAlertMetricsRecorder(): AlertMetricsRecorder {
  const counts = new Map<string, { delivered: number; failed: number }>();
  let escalationsTriggered = 0;

  function bump(channel: string, key: "delivered" | "failed"): void {
    const entry = counts.get(channel) ?? { delivered: 0, failed: 0 };
    entry[key] += 1;
    counts.set(channel, entry);
  }

  return {
    recordDeliverySuccess(channel: string): void {
      bump(channel, "delivered");
    },
    recordDeliveryFailure(channel: string): void {
      bump(channel, "failed");
    },
    recordEscalation(): void {
      escalationsTriggered += 1;
    },
    snapshot(): AlertMetricsSnapshot {
      return { byChannel: Object.fromEntries(counts), escalationsTriggered };
    },
  };
}

function sumDroppedThisPeriod(byReason: Readonly<Record<DropReason, number>>): number {
  return byReason.shed_ceiling + byReason.hard_capacity + byReason.sink_failure;
}

interface ConsoleLineInput {
  readonly time: Date;
  readonly signalsPerSecond: number;
  readonly bufferFillFraction: number;
  readonly queueDepth: number;
  readonly activeWorkItems: number | null;
  readonly dropsThisTick: number;
  readonly p50LatencyMs: number | null;
  readonly p99LatencyMs: number | null;
}

/** One line, human-readable in a terminal — not the JSON this used to emit. Exported so it's independently unit-testable. */
export function formatConsoleLine(input: ConsoleLineInput): string {
  const time = input.time.toISOString().slice(11, 19);
  const fillPct = (input.bufferFillFraction * 100).toFixed(1);
  const activeItems = input.activeWorkItems === null ? "n/a" : String(input.activeWorkItems);
  const p50 = input.p50LatencyMs === null ? "n/a" : `${Math.round(input.p50LatencyMs)}ms`;
  const p99 = input.p99LatencyMs === null ? "n/a" : `${Math.round(input.p99LatencyMs)}ms`;
  return `[metrics] ${time}Z | ${input.signalsPerSecond.toFixed(1)}/s | buffer ${fillPct}% | queue depth ${input.queueDepth} | active items ${activeItems} | drops ${input.dropsThisTick} | p50 ${p50} p99 ${p99}`;
}

export interface MetricsReporterOptions {
  readonly intervalMs?: number;
  readonly getBufferStats: () => BufferStats;
  readonly getQueueStats: () => Promise<QueueReportSnapshot>;
  readonly getActiveWorkItemCount: () => Promise<number>;
  /** Only for tick-failure logging — the periodic report line itself bypasses pino entirely (see formatConsoleLine). */
  readonly logger?: Pick<Logger, "error">;
}

/**
 * Writes one plain-text line every intervalMs (default 5s, per the
 * assignment spec) directly to stdout — deliberately not through pino, so
 * this stays a single glance-able line instead of a JSON blob. Everything
 * this line summarizes is also available in full, structured detail via
 * GET /metrics (Prometheus) and GET /health.
 */
export function startMetricsReporter(counter: ThroughputCounter, options: MetricsReporterOptions): () => void {
  const intervalMs = options.intervalMs ?? 5000;
  const seconds = intervalMs / 1000;
  let previousTotalDropped = 0;

  const timer = setInterval(() => {
    void (async (): Promise<void> => {
      const totalAccepted = counter.reset();
      const signalsPerSecond = totalAccepted / seconds;
      lastSignalsPerSecond = signalsPerSecond;

      const bufferStats = options.getBufferStats();
      const totalDroppedNow = sumDroppedThisPeriod(bufferStats.droppedByReason);
      const dropsThisTick = Math.max(0, totalDroppedNow - previousTotalDropped);
      previousTotalDropped = totalDroppedNow;

      const queueSnapshot = await options.getQueueStats();
      const activeWorkItems = await options.getActiveWorkItemCount().catch(() => null);

      process.stdout.write(
        `${formatConsoleLine({
          time: new Date(),
          signalsPerSecond,
          bufferFillFraction: bufferStats.fillFraction,
          queueDepth: queueSnapshot.waitingCount + queueSnapshot.activeCount,
          activeWorkItems,
          dropsThisTick,
          p50LatencyMs: queueSnapshot.p50LatencyMs,
          p99LatencyMs: queueSnapshot.p99LatencyMs,
        })}\n`,
      );
    })().catch((error: unknown) => {
      options.logger?.error({ error }, "metrics reporter tick failed");
    });
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}

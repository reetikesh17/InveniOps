import type { Logger } from "pino";
import type { BufferStats } from "../services/ingestion/buffer.js";

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

/**
 * Tracks per-tick job processed/failed counts and average end-to-end
 * latency (signal receipt -> persisted) for the queue reporter. Reset each
 * time it's read, same pattern as ThroughputCounter — these are rates
 * over the reporting interval, not running totals.
 */
export interface QueueMetricsSnapshot {
  readonly jobsProcessed: number;
  readonly jobsFailed: number;
  readonly averageLatencyMs: number | null;
}

export interface QueueMetricsRecorder {
  recordJobProcessed(latencyMs: number): void;
  recordJobFailed(): void;
  /** Returns the accumulated counts and resets them to zero. */
  reset(): QueueMetricsSnapshot;
}

export function createQueueMetricsRecorder(): QueueMetricsRecorder {
  let jobsProcessed = 0;
  let jobsFailed = 0;
  let totalLatencyMs = 0;

  return {
    recordJobProcessed(latencyMs: number): void {
      jobsProcessed += 1;
      totalLatencyMs += latencyMs;
    },
    recordJobFailed(): void {
      jobsFailed += 1;
    },
    reset(): QueueMetricsSnapshot {
      const snapshot: QueueMetricsSnapshot = {
        jobsProcessed,
        jobsFailed,
        averageLatencyMs: jobsProcessed > 0 ? totalLatencyMs / jobsProcessed : null,
      };
      jobsProcessed = 0;
      jobsFailed = 0;
      totalLatencyMs = 0;
      return snapshot;
    },
  };
}

/**
 * Point-in-time queue depth/DLQ size (live BullMQ counts) plus the raw
 * processed/failed counts and latency average accumulated since the last
 * call — deliberately raw counts, not per-second rates: this function
 * doesn't know the reporting interval, the reporter does (same reasoning
 * as ThroughputCounter.reset() returning a raw total for signalsPerSecond).
 */
export interface QueueReportSnapshot {
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly dlqSize: number;
  readonly jobsProcessed: number;
  readonly jobsFailed: number;
  readonly averageEndToEndLatencyMs: number | null;
}

export interface MetricsReporterOptions {
  readonly logger: Logger;
  readonly intervalMs?: number;
  /** Pulled once per tick, not pushed — keeps this module decoupled from the buffer's internals. */
  readonly getBufferStats?: () => BufferStats;
  /** Async because it queries BullMQ/Redis directly — unlike the buffer, queue depth isn't kept in local memory. */
  readonly getQueueStats?: () => Promise<QueueReportSnapshot>;
}

/** Logs signals/sec (and, if provided, buffer and queue stats) on a fixed interval; returns a function to stop it. */
export function startMetricsReporter(
  counter: ThroughputCounter,
  options: MetricsReporterOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 5000;
  const seconds = intervalMs / 1000;

  const timer = setInterval(() => {
    void (async (): Promise<void> => {
      const total = counter.reset();
      const signalsPerSecond = total / seconds;
      const bufferStats = options.getBufferStats?.();
      const queueSnapshot = options.getQueueStats ? await options.getQueueStats() : undefined;
      const queueStats = queueSnapshot
        ? {
            waitingCount: queueSnapshot.waitingCount,
            activeCount: queueSnapshot.activeCount,
            dlqSize: queueSnapshot.dlqSize,
            jobsProcessedPerSecond: queueSnapshot.jobsProcessed / seconds,
            jobsFailedPerSecond: queueSnapshot.jobsFailed / seconds,
            averageEndToEndLatencyMs: queueSnapshot.averageEndToEndLatencyMs,
          }
        : undefined;

      options.logger.info(
        {
          signalsPerSecond,
          ...(bufferStats ? { buffer: bufferStats } : {}),
          ...(queueStats ? { queue: queueStats } : {}),
        },
        "throughput",
      );
    })().catch((error: unknown) => {
      options.logger.error({ error }, "metrics reporter tick failed");
    });
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}

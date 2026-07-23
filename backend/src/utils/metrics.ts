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

export interface MetricsReporterOptions {
  readonly logger: Logger;
  readonly intervalMs?: number;
  /** Pulled once per tick, not pushed — keeps this module decoupled from the buffer's internals. */
  readonly getBufferStats?: () => BufferStats;
}

/** Logs signals/sec (and, if provided, buffer depth/shed state) on a fixed interval; returns a function to stop it. */
export function startMetricsReporter(
  counter: ThroughputCounter,
  options: MetricsReporterOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 5000;

  const timer = setInterval(() => {
    const total = counter.reset();
    const signalsPerSecond = total / (intervalMs / 1000);
    const bufferStats = options.getBufferStats?.();

    options.logger.info(
      bufferStats ? { signalsPerSecond, buffer: bufferStats } : { signalsPerSecond },
      "throughput",
    );
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}

import type { Logger } from "pino";

export interface ThroughputCounter {
  increment(amount?: number): void;
  /** Returns the current count and resets it to zero. */
  reset(): number;
}

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
}

/** Logs signals/sec on a fixed interval and returns a function to stop the reporter. */
export function startMetricsReporter(
  counter: ThroughputCounter,
  options: MetricsReporterOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 5000;

  const timer = setInterval(() => {
    const total = counter.reset();
    const signalsPerSecond = total / (intervalMs / 1000);
    options.logger.info({ signalsPerSecond }, "throughput");
  }, intervalMs);

  timer.unref();

  return () => clearInterval(timer);
}

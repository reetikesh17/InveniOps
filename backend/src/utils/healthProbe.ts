import type { Logger } from "pino";

export interface CachedProbeOptions<T> {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  /** Served until the first tick completes, and again whenever a tick fails — see the class comment. */
  readonly fallback: T;
  /** Included in every log line and error message so multiple probes in one process are distinguishable. */
  readonly label: string;
  readonly logger?: Pick<Logger, "error">;
}

function timeoutRejection(label: string, ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`${label} probe timed out after ${ms}ms`)), ms);
  });
}

/**
 * Runs `fetch` on a fixed interval, in the background, and serves whatever
 * it last successfully produced from an in-memory cache — `.get()` is
 * always synchronous, zero I/O, and therefore always fast, which is the
 * entire point: GET /health and GET /metrics must never block a request on
 * a live, possibly-hanging dependency call.
 *
 * Each tick is bounded by `timeoutMs` via Promise.race — note this only
 * stops *waiting* on a hung `fetch`, it doesn't cancel it; a permanently
 * wedged dependency leaves one abandoned in-flight call per tick running
 * in the background indefinitely, in addition to the next tick's own
 * attempt. Acceptable here since the checks this wraps (a ping, a queue
 * depth query) are cheap and this is a small, bounded number of
 * concurrent stragglers, not something worth adding cancellation
 * machinery for in this project's scope.
 *
 * On a failed or timed-out tick, the previous snapshot (or `fallback` if
 * there hasn't been a successful tick yet) keeps being served rather than
 * the cache going blank — callers decide for themselves whether a stale
 * snapshot should read as healthy or not (see api/routes/health.ts, which
 * treats the fallback's "down" status as the correct answer for "never
 * successfully probed yet").
 */
export class CachedProbe<T> {
  private snapshot: T;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly fetch: () => Promise<T>,
    private readonly options: CachedProbeOptions<T>,
  ) {
    this.snapshot = options.fallback;
  }

  /** Runs one tick immediately (so `.get()` isn't wrong for the whole first interval after boot), then starts the background loop. Idempotent. */
  async start(): Promise<void> {
    if (this.timer) {
      return;
    }
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get(): T {
    return this.snapshot;
  }

  private async tick(): Promise<void> {
    try {
      this.snapshot = await Promise.race([this.fetch(), timeoutRejection(this.options.label, this.options.timeoutMs)]);
    } catch (error) {
      this.options.logger?.error({ error, probe: this.options.label }, "cached probe tick failed — serving last known snapshot");
    }
  }
}

export type DependencyStatus = "up" | "down";

export interface ProbeResult {
  readonly status: DependencyStatus;
  readonly latencyMs: number;
}

/** One dependency check, individually timeout-bounded — used to build a multi-dependency CachedProbe<T> fetch function (see services/observability/healthProbeInstance.ts). */
export async function probeDependency(
  name: string,
  check: () => Promise<void>,
  timeoutMs: number,
  logger?: Pick<Logger, "error">,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await Promise.race([check(), timeoutRejection(name, timeoutMs)]);
    return { status: "up", latencyMs: Date.now() - start };
  } catch (error) {
    logger?.error({ error, dependency: name }, "dependency health probe failed");
    return { status: "down", latencyMs: Date.now() - start };
  }
}

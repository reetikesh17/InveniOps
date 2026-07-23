import { ComponentType, Severity } from "@prisma/client";
import type { Logger } from "pino";

// Deliberately no import of config/index.ts or utils/logger.ts here (both
// pull in config, which hard-exits the process if DATABASE_URL etc. aren't
// set) — that would force every unit test of this pure class to run with a
// full environment, breaking the zero-setup convention the rest of the
// unit suite relies on. The logger is injected instead, and the actually
// wired-up singleton (config values + the shared logger) lives in
// signalBufferInstance.ts, which only infra bootstrap code should import.

// The normalized shape a validated signal takes once it leaves the API
// layer, before it's buffered. Distinct from
// repositories/mongo/signalRepository.ts's SignalDocument — that's the
// persistence shape a real SignalSink writes, once one exists.
export interface IngestionSignal {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly rawPayload: unknown;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
}

/**
 * Where drained batches go. The only implementation today is
 * noopSignalSink — see its comment for why a real one isn't wired up yet.
 */
export interface SignalSink {
  drain(batch: readonly IngestionSignal[]): Promise<void>;
}

// TODO(next prompt): replace with a real sink — a BullMQ producer that
// enqueues each batch for async processing (Mongo persistence + the
// debouncer). Not implemented here: BullMQ isn't a project dependency yet,
// and standing up a queue is its own scoped piece of work, not something to
// fold into the buffer itself. The buffer is written against this
// interface so swapping the sink later touches nothing else.
export const noopSignalSink: SignalSink = {
  drain(batch: readonly IngestionSignal[]): Promise<void> {
    void batch;
    return Promise.resolve();
  },
};

export type BufferState = "normal" | "shedding";

export type DropReason = "shed_ceiling" | "hard_capacity" | "sink_failure";

export type SubmitResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: Exclude<DropReason, "sink_failure"> };

export interface BufferStats {
  readonly capacity: number;
  readonly totalSize: number;
  readonly fillFraction: number;
  readonly state: BufferState;
  readonly depthBySeverity: Readonly<Record<Severity, number>>;
  readonly droppedBySeverity: Readonly<Record<Severity, number>>;
  readonly droppedByReason: Readonly<Record<DropReason, number>>;
}

export interface DrainAllResult {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly remaining: number;
}

export interface SignalBufferOptions {
  readonly capacity: number;
  readonly highWaterMarkFraction: number;
  readonly lowWaterMarkFraction: number;
  /** Fractions of `capacity` a severity may occupy once shedding is active. P0 has none — it's never ceiling-shed. */
  readonly shedCeilingFractions: Readonly<Record<Exclude<Severity, typeof Severity.P0>, number>>;
  readonly drainBatchSize: number;
  readonly drainIntervalMs: number;
  readonly sink: SignalSink;
  /** Optional — logging is a no-op when omitted, which is what every test in this file relies on. */
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
}

const PRIORITY_ORDER: readonly Severity[] = [Severity.P0, Severity.P1, Severity.P2, Severity.P3];

/**
 * Fixed-capacity circular buffer: preallocated array, wrapping head/tail
 * indices, O(1) push/pop. Every SignalBuffer severity lane is one of these,
 * each preallocated at the *full* shared capacity (not capacity/4) so a
 * legitimate single-severity flood can use the whole buffer while the
 * system is in its normal state — see docs/backpressure.md. The shared
 * `capacity` invariant is enforced by SignalBuffer, one level up; this
 * class only refuses to grow past its own preallocated size.
 */
class RingBuffer<T> {
  private readonly slots: Array<T | undefined>;
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.slots = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): boolean {
    if (this.count === this.capacity) {
      return false;
    }
    const tail = (this.head + this.count) % this.capacity;
    this.slots[tail] = item;
    this.count += 1;
    return true;
  }

  popOldest(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const item = this.slots[this.head];
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
    return item;
  }

  popBatch(maxItems: number): T[] {
    const n = Math.min(maxItems, this.count);
    const result: T[] = [];
    for (let i = 0; i < n; i += 1) {
      const item = this.popOldest();
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }
}

/**
 * Bounded in-memory buffer sitting between the ingestion HTTP handler and
 * async processing. See docs/backpressure.md for the full design rationale
 * — in short: four severity-partitioned ring buffers sharing one hard
 * capacity, watermark hysteresis decides when to start/stop shedding, and
 * shedding is enforced via per-severity ceilings so low severities run out
 * of room before high ones do. P0 is exempt from ceiling shedding entirely.
 */
export class SignalBuffer {
  private readonly queues: Readonly<Record<Severity, RingBuffer<IngestionSignal>>>;
  private readonly droppedBySeverity: Record<Severity, number> = {
    [Severity.P0]: 0,
    [Severity.P1]: 0,
    [Severity.P2]: 0,
    [Severity.P3]: 0,
  };

  private readonly droppedByReason: Record<DropReason, number> = {
    shed_ceiling: 0,
    hard_capacity: 0,
    sink_failure: 0,
  };

  private state: BufferState = "normal";
  private timer: NodeJS.Timeout | undefined;
  private draining = false;
  private sink: SignalSink;

  constructor(private readonly options: SignalBufferOptions) {
    this.queues = {
      [Severity.P0]: new RingBuffer(options.capacity),
      [Severity.P1]: new RingBuffer(options.capacity),
      [Severity.P2]: new RingBuffer(options.capacity),
      [Severity.P3]: new RingBuffer(options.capacity),
    };
    this.sink = options.sink;
  }

  /**
   * Swaps the sink after construction — needed because the real sink (a
   * BullMQ producer, see src/workers/bullMqSink.ts) needs a live Redis
   * connection and is only safe to construct after src/index.ts's
   * connectClients() has run, while this buffer's singleton
   * (signalBufferInstance.ts) is constructed eagerly at module load with
   * noopSignalSink. index.ts calls this once during bootstrap, before
   * start().
   */
  setSink(sink: SignalSink): void {
    this.sink = sink;
  }

  get totalSize(): number {
    return PRIORITY_ORDER.reduce((sum, severity) => sum + this.queues[severity].size, 0);
  }

  get bufferState(): BufferState {
    return this.state;
  }

  /**
   * Synchronous and non-blocking — the point of this whole class. Never
   * touches the network or disk; the caller (the ingestion route) can
   * decide 202 vs 503 from the return value immediately.
   */
  submit(signal: IngestionSignal): SubmitResult {
    const { severity } = signal;

    if (this.state === "shedding" && severity !== Severity.P0) {
      const ceilingFraction = this.options.shedCeilingFractions[severity];
      const ceiling = Math.floor(this.options.capacity * ceilingFraction);
      if (this.queues[severity].size >= ceiling) {
        this.recordDrop(severity, "shed_ceiling");
        return { accepted: false, reason: "shed_ceiling" };
      }
    }

    if (this.totalSize >= this.options.capacity) {
      if (severity === Severity.P0) {
        this.evictToMakeRoomForP0();
      } else {
        this.recordDrop(severity, "hard_capacity");
        return { accepted: false, reason: "hard_capacity" };
      }
    }

    this.queues[severity].push(signal);
    this.recomputeState();
    return { accepted: true };
  }

  /**
   * Buffer is at hard capacity and a P0 needs a slot. Evict the oldest item
   * from the lowest-severity non-empty queue — P3 first, then P2, then P1
   * — so a P0 is only ever sacrificed when it's the *only* thing in the
   * buffer (every lower severity queue is empty). That case is logged at
   * error level: it means sustained P0-only volume alone is exceeding
   * capacity, which the configured capacity is sized to make practically
   * unreachable (see docs/backpressure.md).
   */
  private evictToMakeRoomForP0(): void {
    const victimSeverity = [...PRIORITY_ORDER].reverse().find((severity) => this.queues[severity].size > 0);
    if (victimSeverity === undefined) {
      return;
    }
    const evicted = this.queues[victimSeverity].popOldest();
    if (evicted === undefined) {
      return;
    }
    this.recordDrop(victimSeverity, "hard_capacity");
    if (victimSeverity === Severity.P0) {
      this.options.logger?.error(
        { evictedSignalId: evicted.signalId },
        "P0 signal evicted at hard buffer capacity — sustained P0-only volume is exceeding buffer capacity",
      );
    }
  }

  private recordDrop(severity: Severity, reason: DropReason): void {
    this.droppedBySeverity[severity] += 1;
    this.droppedByReason[reason] += 1;
  }

  private recomputeState(): void {
    const fill = this.options.capacity === 0 ? 0 : this.totalSize / this.options.capacity;
    if (this.state === "normal" && fill >= this.options.highWaterMarkFraction) {
      this.state = "shedding";
      this.options.logger?.warn({ fill }, "ingestion buffer entering shedding state");
    } else if (this.state === "shedding" && fill <= this.options.lowWaterMarkFraction) {
      this.state = "normal";
      this.options.logger?.info({ fill }, "ingestion buffer exiting shedding state");
    }
  }

  private popPriorityBatch(maxItems: number): IngestionSignal[] {
    const result: IngestionSignal[] = [];
    for (const severity of PRIORITY_ORDER) {
      if (result.length >= maxItems) {
        break;
      }
      result.push(...this.queues[severity].popBatch(maxItems - result.length));
    }
    return result;
  }

  /**
   * Pops one priority-ordered batch and hands it to the sink. A sink
   * failure drops the whole batch (counted, logged) rather than
   * re-queuing it — see docs/backpressure.md for why re-queuing is
   * deliberately out of scope here.
   */
  async drainToSink(maxItems: number = this.options.drainBatchSize): Promise<{ drained: number; failed: number }> {
    const batch = this.popPriorityBatch(maxItems);
    if (batch.length === 0) {
      return { drained: 0, failed: 0 };
    }
    this.recomputeState();

    try {
      await this.sink.drain(batch);
      return { drained: batch.length, failed: 0 };
    } catch (error) {
      for (const signal of batch) {
        this.recordDrop(signal.severity, "sink_failure");
      }
      this.options.logger?.error(
        { error, batchSize: batch.length },
        "signal sink failed to drain a batch — batch dropped",
      );
      return { drained: 0, failed: batch.length };
    }
  }

  /** Starts the interval-driven drain loop. Idempotent. */
  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.draining) {
        return;
      }
      this.draining = true;
      void this.drainToSink()
        .catch((error: unknown) => {
          this.options.logger?.error({ error }, "unexpected error in buffer drain tick");
        })
        .finally(() => {
          this.draining = false;
        });
    }, this.options.drainIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Drains everything, ignoring the normal interval, until the buffer is
   * empty or `timeoutMs` elapses — used on shutdown so in-flight signals
   * aren't silently lost when the process exits.
   */
  async drainAll(timeoutMs: number): Promise<DrainAllResult> {
    const deadline = Date.now() + timeoutMs;
    let succeeded = 0;
    let failed = 0;

    while (this.totalSize > 0 && Date.now() < deadline) {
      const result = await this.drainToSink(this.options.drainBatchSize);
      succeeded += result.drained;
      failed += result.failed;
    }

    return { processed: succeeded + failed, succeeded, failed, remaining: this.totalSize };
  }

  getStats(): BufferStats {
    const depthBySeverity: Record<Severity, number> = {
      [Severity.P0]: this.queues[Severity.P0].size,
      [Severity.P1]: this.queues[Severity.P1].size,
      [Severity.P2]: this.queues[Severity.P2].size,
      [Severity.P3]: this.queues[Severity.P3].size,
    };

    return {
      capacity: this.options.capacity,
      totalSize: this.totalSize,
      fillFraction: this.options.capacity === 0 ? 0 : this.totalSize / this.options.capacity,
      state: this.state,
      depthBySeverity,
      droppedBySeverity: { ...this.droppedBySeverity },
      droppedByReason: { ...this.droppedByReason },
    };
  }
}

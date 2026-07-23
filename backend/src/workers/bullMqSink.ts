import type { Queue } from "bullmq";
import type { SignalSink, IngestionSignal } from "../services/ingestion/buffer.js";
import { enqueueSignalBatch, type SignalBatchJobData } from "./queue.js";

/**
 * Realizes the "buffer-to-queue drainer" by implementing SignalSink: the
 * buffer already has an interval-driven drain loop with a configurable
 * batch size and flush interval (BUFFER_DRAIN_BATCH_SIZE /
 * BUFFER_DRAIN_INTERVAL_MS, see services/ingestion/buffer.ts) — that *is*
 * the drainer. This just plugs a real destination (one BullMQ job per
 * drained batch) into it, replacing the noop stub.
 */
export class BullMqSignalSink implements SignalSink {
  constructor(private readonly queue: Queue<SignalBatchJobData>) {}

  async drain(batch: readonly IngestionSignal[]): Promise<void> {
    await enqueueSignalBatch(this.queue, batch);
  }
}

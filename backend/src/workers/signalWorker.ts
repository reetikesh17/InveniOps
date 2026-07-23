import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { QueueMetricsRecorder } from "../utils/metrics.js";
import {
  SIGNAL_BATCH_QUEUE_NAME,
  DEAD_LETTER_JOB_NAME,
  deserializeSignal,
  type SignalBatchJobData,
  type DeadLetterJobData,
  createDeadLetterQueue,
} from "./queue.js";
import { processBatch, type ProcessBatchDeps } from "./processBatch.js";

export interface SignalWorkerDeps extends ProcessBatchDeps {
  readonly deadLetterQueue: ReturnType<typeof createDeadLetterQueue>;
  readonly metrics?: QueueMetricsRecorder;
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
}

/**
 * Processes one batch per job: debounce -> bulk-persist -> count update ->
 * cache refresh (processBatch.ts). Retry with exponential backoff is
 * BullMQ's own job option (set where jobs are enqueued, see
 * queue.ts#enqueueSignalBatch) — this worker's own responsibility is
 * running the job and, once BullMQ has exhausted every attempt, forwarding
 * it to the dead letter queue with the failure reason attached.
 */
export function createSignalWorker(
  connection: Redis,
  concurrency: number,
  deps: SignalWorkerDeps,
): Worker<SignalBatchJobData> {
  const worker = new Worker<SignalBatchJobData>(
    SIGNAL_BATCH_QUEUE_NAME,
    async (job: Job<SignalBatchJobData>) => {
      const signals = job.data.signals.map(deserializeSignal);
      const result = await processBatch(signals, deps);

      if (signals.length > 0) {
        const oldestReceivedAtMs = signals.reduce(
          (oldest, signal) => Math.min(oldest, signal.receivedAt.getTime()),
          Date.now(),
        );
        deps.metrics?.recordJobProcessed(Date.now() - oldestReceivedAtMs);
      }

      return result;
    },
    { connection, concurrency },
  );

  worker.on("failed", (job, error) => {
    deps.metrics?.recordJobFailed();

    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      // BullMQ will retry this one automatically (with the configured
      // exponential backoff) — not exhausted yet, nothing to forward.
      return;
    }

    void forwardToDeadLetterQueue(deps.deadLetterQueue, job, error).catch((dlqError: unknown) => {
      deps.logger?.error({ dlqError, jobId: job.id }, "failed to forward exhausted job to the dead letter queue");
    });
  });

  return worker;
}

async function forwardToDeadLetterQueue(
  deadLetterQueue: ReturnType<typeof createDeadLetterQueue>,
  job: Job<SignalBatchJobData>,
  error: Error,
): Promise<void> {
  const dlqData: DeadLetterJobData = {
    originalJobId: job.id ?? "unknown",
    originalJobName: job.name,
    attemptsMade: job.attemptsMade,
    failureReason: error.message,
    failedAt: new Date().toISOString(),
    data: job.data,
  };
  await deadLetterQueue.add(DEAD_LETTER_JOB_NAME, dlqData);
}

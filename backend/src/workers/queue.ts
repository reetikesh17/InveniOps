import { Queue } from "bullmq";
import type { ComponentType, Severity } from "@prisma/client";
import { config } from "../config/index.js";
import type { IngestionSignal } from "../services/ingestion/buffer.js";
import { queueConnection } from "./connection.js";

export const SIGNAL_BATCH_QUEUE_NAME = "signal-batch-processing";
export const SIGNAL_BATCH_DLQ_NAME = "signal-batch-dlq";
export const SIGNAL_BATCH_JOB_NAME = "process-batch";
export const DEAD_LETTER_JOB_NAME = "dead-letter";

// BullMQ job data is JSON-serialized through Redis — Date instances don't
// survive that round trip as Dates, only as strings — so the wire payload
// carries ISO strings and gets rehydrated back into IngestionSignal (real
// Dates) by the worker before anything downstream sees it.
export interface SerializedIngestionSignal {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly rawPayload: unknown;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly correlationId: string;
}

export interface SignalBatchJobData {
  readonly signals: readonly SerializedIngestionSignal[];
}

export interface DeadLetterJobData {
  readonly originalJobId: string;
  readonly originalJobName: string;
  readonly attemptsMade: number;
  readonly failureReason: string;
  readonly failedAt: string;
  readonly data: SignalBatchJobData;
}

export function serializeSignal(signal: IngestionSignal): SerializedIngestionSignal {
  return {
    signalId: signal.signalId,
    componentId: signal.componentId,
    componentType: signal.componentType,
    severity: signal.severity,
    rawPayload: signal.rawPayload,
    occurredAt: signal.occurredAt.toISOString(),
    receivedAt: signal.receivedAt.toISOString(),
    correlationId: signal.correlationId,
  };
}

export function deserializeSignal(signal: SerializedIngestionSignal): IngestionSignal {
  return {
    signalId: signal.signalId,
    componentId: signal.componentId,
    componentType: signal.componentType,
    severity: signal.severity,
    rawPayload: signal.rawPayload,
    occurredAt: new Date(signal.occurredAt),
    receivedAt: new Date(signal.receivedAt),
    correlationId: signal.correlationId,
  };
}

export function createSignalBatchQueue(): Queue<SignalBatchJobData> {
  return new Queue<SignalBatchJobData>(SIGNAL_BATCH_QUEUE_NAME, { connection: queueConnection });
}

export function createDeadLetterQueue(): Queue<DeadLetterJobData> {
  return new Queue<DeadLetterJobData>(SIGNAL_BATCH_DLQ_NAME, { connection: queueConnection });
}

/** One job per batch — this is the "buffer-to-queue drainer," realized as a SignalSink; see bullMqSink.ts. */
export async function enqueueSignalBatch(
  queue: Queue<SignalBatchJobData>,
  signals: readonly IngestionSignal[],
): Promise<void> {
  if (signals.length === 0) {
    return;
  }
  const jobData: SignalBatchJobData = { signals: signals.map(serializeSignal) };
  await queue.add(SIGNAL_BATCH_JOB_NAME, jobData, {
    attempts: config.queue.maxAttempts,
    backoff: { type: "exponential", delay: config.queue.backoffDelayMs },
    removeOnComplete: { count: config.queue.removeOnCompleteCount },
    removeOnFail: { count: config.queue.removeOnFailCount },
  });
}

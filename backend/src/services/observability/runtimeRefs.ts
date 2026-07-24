import type { Worker } from "bullmq";
import type { QueueMetricsRecorder } from "../../utils/metrics.js";
import type { SignalBatchJobData } from "../../workers/queue.js";

// A handful of things GET /ready and GET /metrics need to read that only
// exist once src/index.ts's bootstrap has called startWorkerSystem() —
// later than these route modules are first imported (ES imports are
// hoisted ahead of any bootstrap code). Same "construct/import early,
// wire the real dependency in once it exists" shape as
// SignalBuffer.setSink(); routes read through the getter every request,
// so whichever value is current by the time a request lands is what they
// see — no import-order hazard, just "not ready yet" until index.ts calls
// setWorkerRuntimeRefs().
export interface QueueHandles {
  getWaitingCount(): Promise<number>;
  getActiveCount(): Promise<number>;
  getJobCounts(): Promise<Record<string, number>>;
}

export interface WorkerRuntimeRefs {
  readonly worker: Pick<Worker<SignalBatchJobData>, "isRunning">;
  readonly queue: Pick<QueueHandles, "getWaitingCount" | "getActiveCount">;
  readonly deadLetterQueue: Pick<QueueHandles, "getJobCounts">;
  readonly metrics: QueueMetricsRecorder;
}

let refs: WorkerRuntimeRefs | undefined;

export function setWorkerRuntimeRefs(next: WorkerRuntimeRefs): void {
  refs = next;
}

export function getWorkerRuntimeRefs(): WorkerRuntimeRefs | undefined {
  return refs;
}

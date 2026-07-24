import type { Queue, Worker } from "bullmq";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { createQueueMetricsRecorder, type QueueMetricsRecorder, type QueueReportSnapshot } from "../utils/metrics.js";
import { prisma, getMongoDb, redis } from "../repositories/clients.js";
import { PostgresWorkItemRepository } from "../repositories/postgres/workItemRepository.js";
import { MongoSignalRepository } from "../repositories/mongo/signalRepository.js";
import { DashboardCacheRepository } from "../repositories/redis/dashboardCache.js";
import { SignalDebouncer } from "../services/ingestion/debouncer.js";
import type { SignalSink } from "../services/ingestion/buffer.js";
import { alertDispatcher } from "../services/alerting/alertingInstance.js";
import { getMetricsWriter } from "../services/aggregation/aggregationInstance.js";
import { incidentEventPublisher } from "../services/realtime/realtimeInstance.js";
import { MongoMetricsRepository } from "../repositories/metrics/index.js";
import { queueConnection } from "./connection.js";
import { createSignalBatchQueue, createDeadLetterQueue, type SignalBatchJobData, type DeadLetterJobData } from "./queue.js";
import { createSignalWorker } from "./signalWorker.js";
import { BullMqSignalSink } from "./bullMqSink.js";

export interface WorkerSystem {
  readonly queue: Queue<SignalBatchJobData>;
  readonly deadLetterQueue: Queue<DeadLetterJobData>;
  readonly worker: Worker<SignalBatchJobData>;
  /** Hand this to SignalBuffer.setSink() to wire the buffer's drain loop into the queue. */
  readonly sink: SignalSink;
  /** Exposed for GET /metrics's cumulative counters and latency histogram — see src/api/routes/metrics.ts. */
  readonly metrics: QueueMetricsRecorder;
  getQueueStats(): Promise<QueueReportSnapshot>;
}

/**
 * Wires the full write path: queue + DLQ + worker (debounce -> Mongo ->
 * Postgres -> dashboard cache) + a SignalSink for the buffer to drain
 * into. Must only be called after connectClients() has resolved — the
 * worker's processor needs a live Mongo connection (getMongoDb() throws
 * before that) and a meaningfully-connected Postgres/Redis client.
 */
export async function startWorkerSystem(): Promise<WorkerSystem> {
  const queue = createSignalBatchQueue();
  const deadLetterQueue = createDeadLetterQueue();

  const workItemStore = new PostgresWorkItemRepository(prisma);
  const signalStore = new MongoSignalRepository(getMongoDb());
  // Idempotent (createIndex is a no-op if the index already exists) —
  // provisions the unique index on signalId that insertManyIdempotent
  // relies on as its correctness backstop, plus the workItemId index that
  // countByWorkItemId/findByWorkItemId now need since they're on the
  // ingestion hot path via the cache-refresh step, not just RCA/detail
  // views.
  await signalStore.ensureIndexes();
  // Idempotent, same reasoning — provisions the 5 time-series collections
  // (src/repositories/metrics/) the aggregation write path below needs.
  await new MongoMetricsRepository(getMongoDb()).ensureCollections();
  const cache = new DashboardCacheRepository(redis, config.dashboard.cacheTtlSeconds);

  const debouncer = new SignalDebouncer(workItemStore, signalStore, redis, {
    windowSeconds: config.debounce.windowSeconds,
    threshold: config.debounce.threshold,
    lockTtlMs: config.debounce.lockTtlMs,
    lockWaitTimeoutMs: config.debounce.lockWaitTimeoutMs,
    lockPollIntervalMs: config.debounce.lockPollIntervalMs,
    logger,
  });

  const metrics = createQueueMetricsRecorder();

  const worker = createSignalWorker(queueConnection, config.queue.workerConcurrency, {
    debouncer,
    signalStore,
    workItemStore,
    cache,
    alertDispatcher,
    metricsWriter: getMetricsWriter(),
    eventPublisher: incidentEventPublisher,
    deadLetterQueue,
    metrics,
    logger,
  });

  const sink = new BullMqSignalSink(queue);

  async function getQueueStats(): Promise<QueueReportSnapshot> {
    const [waitingCount, activeCount, dlqJobCounts] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      deadLetterQueue.getJobCounts(),
    ]);
    const dlqSize = Object.values(dlqJobCounts).reduce((sum, count) => sum + count, 0);
    const { jobsProcessed, jobsFailed, averageLatencyMs, p50LatencyMs, p99LatencyMs } = metrics.reset();

    return {
      waitingCount,
      activeCount,
      dlqSize,
      jobsProcessed,
      jobsFailed,
      averageEndToEndLatencyMs: averageLatencyMs,
      p50LatencyMs,
      p99LatencyMs,
    };
  }

  return { queue, deadLetterQueue, worker, sink, metrics, getQueueStats };
}

/** Graceful shutdown: stop pulling new jobs, let in-flight ones finish (bounded by timeoutMs), then close connections. */
export async function stopWorkerSystem(system: WorkerSystem, timeoutMs: number): Promise<void> {
  await Promise.race([
    system.worker.close(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  await system.queue.close();
  await system.deadLetterQueue.close();
}

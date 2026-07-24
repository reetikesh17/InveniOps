import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { prisma, getMongoDb, redis } from "../../repositories/clients.js";
import { queueConnection } from "../../workers/connection.js";
import { CachedProbe, probeDependency, type ProbeResult } from "../../utils/healthProbe.js";
import { getWorkerRuntimeRefs } from "./runtimeRefs.js";

export interface HealthSnapshot {
  readonly postgres: ProbeResult;
  readonly mongo: ProbeResult;
  readonly redis: ProbeResult;
  readonly queue: ProbeResult;
}

const NEVER_PROBED: ProbeResult = { status: "down", latencyMs: 0 };
const HEALTH_FALLBACK: HealthSnapshot = { postgres: NEVER_PROBED, mongo: NEVER_PROBED, redis: NEVER_PROBED, queue: NEVER_PROBED };

async function checkPostgres(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

async function checkMongo(): Promise<void> {
  await getMongoDb().command({ ping: 1 });
}

async function checkRedis(): Promise<void> {
  const reply: string = await redis.ping();
  if (reply !== "PONG") {
    throw new Error(`unexpected redis ping reply: ${reply}`);
  }
}

// The queue's own Redis connection (src/workers/connection.ts) — distinct
// from the general-purpose `redis` client above, since BullMQ requires
// maxRetriesPerRequest: null on its connection (see connection.ts).
async function checkQueue(): Promise<void> {
  const reply: string = await queueConnection.ping();
  if (reply !== "PONG") {
    throw new Error(`unexpected queue redis ping reply: ${reply}`);
  }
}

async function fetchHealthSnapshot(): Promise<HealthSnapshot> {
  const timeoutMs = config.health.probeTimeoutMs;
  const [postgres, mongo, redisResult, queue] = await Promise.all([
    probeDependency("postgres", checkPostgres, timeoutMs, logger),
    probeDependency("mongo", checkMongo, timeoutMs, logger),
    probeDependency("redis", checkRedis, timeoutMs, logger),
    probeDependency("queue", checkQueue, timeoutMs, logger),
  ]);
  return { postgres, mongo, redis: redisResult, queue };
}

/** GET /health's dependency up/down + latency — cached, refreshed in the background, never queried live on the request path. */
export const dependencyHealthProbe: CachedProbe<HealthSnapshot> = new CachedProbe(fetchHealthSnapshot, {
  intervalMs: config.health.probeIntervalMs,
  timeoutMs: config.health.probeTimeoutMs,
  fallback: HEALTH_FALLBACK,
  label: "dependency-health",
  logger,
});

export interface QueueDepthSnapshot {
  readonly waitingCount: number;
  readonly activeCount: number;
  readonly dlqSize: number;
}

const QUEUE_DEPTH_FALLBACK: QueueDepthSnapshot = { waitingCount: 0, activeCount: 0, dlqSize: 0 };

async function fetchQueueDepth(): Promise<QueueDepthSnapshot> {
  const refs = getWorkerRuntimeRefs();
  if (!refs) {
    // Worker system hasn't finished starting yet — self-heals on the next
    // tick once index.ts calls setWorkerRuntimeRefs(); not an error.
    return QUEUE_DEPTH_FALLBACK;
  }
  const [waitingCount, activeCount, dlqJobCounts] = await Promise.all([
    refs.queue.getWaitingCount(),
    refs.queue.getActiveCount(),
    refs.deadLetterQueue.getJobCounts(),
  ]);
  const dlqSize = Object.values(dlqJobCounts).reduce((sum, count) => sum + count, 0);
  return { waitingCount, activeCount, dlqSize };
}

/** GET /health's queue depth — same cached, non-blocking posture as dependencyHealthProbe. */
export const queueDepthProbe: CachedProbe<QueueDepthSnapshot> = new CachedProbe(fetchQueueDepth, {
  intervalMs: config.health.probeIntervalMs,
  timeoutMs: config.health.probeTimeoutMs,
  fallback: QUEUE_DEPTH_FALLBACK,
  label: "queue-depth",
  logger,
});

export async function startHealthProbes(): Promise<void> {
  await Promise.all([dependencyHealthProbe.start(), queueDepthProbe.start()]);
}

export function stopHealthProbes(): void {
  dependencyHealthProbe.stop();
  queueDepthProbe.stop();
}

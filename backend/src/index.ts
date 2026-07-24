import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { startMetricsReporter, throughputCounter } from "./utils/metrics.js";
import { connectClients, registerShutdownHooks, prisma } from "./repositories/clients.js";
import { PostgresWorkItemRepository } from "./repositories/postgres/index.js";
import { createApp } from "./api/app.js";
import { signalBuffer } from "./services/ingestion/signalBufferInstance.js";
import { escalationScheduler } from "./services/alerting/alertingInstance.js";
import { setWorkerRuntimeRefs } from "./services/observability/runtimeRefs.js";
import { startHealthProbes, stopHealthProbes } from "./services/observability/healthProbeInstance.js";
import { incidentEventSubscriber } from "./services/realtime/realtimeInstance.js";
import { startWorkerSystem, stopWorkerSystem } from "./workers/index.js";

async function main(): Promise<void> {
  await connectClients();
  await incidentEventSubscriber.start();

  const app = createApp();

  // Must come after connectClients(): the worker's processor needs a live
  // Mongo connection (getMongoDb() throws before that) and a meaningfully
  // connected Postgres/Redis client.
  const workerSystem = await startWorkerSystem();
  signalBuffer.setSink(workerSystem.sink);
  signalBuffer.start();
  escalationScheduler.start();

  // GET /ready and GET /metrics need these — see
  // services/observability/runtimeRefs.ts for why this late-binding
  // handoff exists instead of importing workerSystem directly.
  setWorkerRuntimeRefs({
    worker: workerSystem.worker,
    queue: workerSystem.queue,
    deadLetterQueue: workerSystem.deadLetterQueue,
    metrics: workerSystem.metrics,
  });

  // After setWorkerRuntimeRefs so the probes' very first tick already has
  // real queue depth to report, not a transient zero.
  await startHealthProbes();

  const workItemStore = new PostgresWorkItemRepository(prisma);

  const stopMetricsReporter = startMetricsReporter(throughputCounter, {
    logger,
    getBufferStats: () => signalBuffer.getStats(),
    getQueueStats: () => workerSystem.getQueueStats(),
    getActiveWorkItemCount: () => workItemStore.countActive(),
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "server listening");
  });

  registerShutdownHooks(async () => {
    stopMetricsReporter();
    stopHealthProbes();
    await incidentEventSubscriber.stop();
    escalationScheduler.stop();
    signalBuffer.stop();
    const drainResult = await signalBuffer.drainAll(config.buffer.shutdownDrainTimeoutMs);
    logger.info({ drainResult }, "drained ingestion buffer on shutdown");
    await stopWorkerSystem(workerSystem, config.queue.shutdownTimeoutMs);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
}

main().catch((error: unknown) => {
  logger.error({ error }, "failed to start server");
  process.exit(1);
});

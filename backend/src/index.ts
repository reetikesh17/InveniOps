import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { startMetricsReporter, throughputCounter } from "./utils/metrics.js";
import { connectClients, registerShutdownHooks } from "./repositories/clients.js";
import { createApp } from "./api/app.js";
import { signalBuffer } from "./services/ingestion/signalBufferInstance.js";
import { startWorkerSystem, stopWorkerSystem } from "./workers/index.js";

async function main(): Promise<void> {
  await connectClients();

  const app = createApp();

  // Must come after connectClients(): the worker's processor needs a live
  // Mongo connection (getMongoDb() throws before that) and a meaningfully
  // connected Postgres/Redis client.
  const workerSystem = await startWorkerSystem();
  signalBuffer.setSink(workerSystem.sink);
  signalBuffer.start();

  const stopMetricsReporter = startMetricsReporter(throughputCounter, {
    logger,
    getBufferStats: () => signalBuffer.getStats(),
    getQueueStats: () => workerSystem.getQueueStats(),
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "server listening");
  });

  registerShutdownHooks(async () => {
    stopMetricsReporter();
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

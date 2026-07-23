import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { startMetricsReporter, throughputCounter } from "./utils/metrics.js";
import { connectClients, registerShutdownHooks } from "./repositories/clients.js";
import { createApp } from "./api/app.js";

async function main(): Promise<void> {
  await connectClients();

  const app = createApp();

  const stopMetricsReporter = startMetricsReporter(throughputCounter, { logger });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "server listening");
  });

  registerShutdownHooks(async () => {
    stopMetricsReporter();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
}

main().catch((error: unknown) => {
  logger.error({ error }, "failed to start server");
  process.exit(1);
});

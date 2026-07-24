import { logger } from "../../utils/logger.js";
import { getMongoDb } from "../../repositories/clients.js";
import { MongoMetricsRepository } from "../../repositories/metrics/index.js";
import { MetricsWriter } from "./metricsWriter.js";

// Deliberately NOT constructed eagerly at module load like
// alertingInstance.ts's alertDispatcher: MongoMetricsRepository needs a
// live Db handle, and getMongoDb() throws until src/index.ts's
// connectClients() has resolved — same constraint MongoSignalRepository
// has (see src/workers/index.ts and src/api/routes/workitems.ts's
// getServices() for the same lazy-after-connect pattern). Memoized so
// every caller shares one instance.
let metricsWriter: MetricsWriter | undefined;

export function getMetricsWriter(): MetricsWriter {
  if (!metricsWriter) {
    metricsWriter = new MetricsWriter(new MongoMetricsRepository(getMongoDb()), { logger });
  }
  return metricsWriter;
}

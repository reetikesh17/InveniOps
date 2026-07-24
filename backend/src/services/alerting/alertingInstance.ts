import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { createAlertMetricsRecorder, type AlertMetricsRecorder } from "../../utils/metrics.js";
import { redis, prisma } from "../../repositories/clients.js";
import { PostgresWorkItemRepository } from "../../repositories/postgres/workItemRepository.js";
import { createDefaultAlertStrategyRegistry } from "../../domain/alerting/index.js";
import { getMetricsWriter } from "../aggregation/aggregationInstance.js";
import { createNotifierRegistry } from "./notifierRegistry.js";
import { AlertDispatcher } from "./dispatcher.js";
import { EscalationScheduler } from "./escalationScheduler.js";

// Constructed eagerly at module load, same posture as
// services/ingestion/signalBufferInstance.ts: none of this issues a
// Redis/Postgres command at construction time (just stores references),
// so it's safe before connectClients() has run. Shared by both
// src/workers/index.ts (dispatch on work item creation) and
// src/api/routes/workitems.ts (dispatch on transition, via
// WorkflowService) so alert metrics aren't split across two independently
// counting instances.
export const alertMetrics: AlertMetricsRecorder = createAlertMetricsRecorder();

const strategyRegistry = createDefaultAlertStrategyRegistry();

const notifierRegistry = createNotifierRegistry(
  {
    slackWebhookUrl: config.alerting.slackWebhookUrl,
    pagerdutyWebhookUrl: config.alerting.pagerdutyWebhookUrl,
    emailWebhookUrl: config.alerting.emailWebhookUrl,
    channelTimeoutMs: config.alerting.channelTimeoutMs,
  },
  logger,
);

export const alertDispatcher: AlertDispatcher = new AlertDispatcher(
  strategyRegistry,
  notifierRegistry,
  redis,
  {
    maxAttempts: config.alerting.maxAttempts,
    backoffDelayMs: config.alerting.backoffDelayMs,
    suppressionWindowSeconds: config.alerting.suppressionWindowSeconds,
  },
  alertMetrics,
  logger,
  // A provider, not getMetricsWriter() called here directly: this module
  // is imported (and this const constructed) before connectClients() has
  // run, but getMetricsWriter() needs a live Mongo connection — see its
  // own comment in aggregationInstance.ts. Passing the function itself
  // defers that call to first dispatch, well after boot.
  getMetricsWriter,
);

export const escalationScheduler: EscalationScheduler = new EscalationScheduler(
  new PostgresWorkItemRepository(prisma),
  strategyRegistry,
  alertDispatcher,
  { checkIntervalMs: config.escalation.checkIntervalMs },
  logger,
);

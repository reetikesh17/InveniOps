import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { redis } from "../../repositories/clients.js";
import { IncidentEventPublisher } from "./eventPublisher.js";
import { IncidentEventSubscriber } from "./eventSubscriber.js";

// Constructed eagerly at module load, same posture as
// services/alerting/alertingInstance.ts: publishing reuses the
// already-connected `redis` singleton (no I/O at construction), and the
// subscriber's constructor only stores its Redis URL — the actual
// connection happens in start(), called explicitly from src/index.ts after
// connectClients(). Shared by workers/index.ts (publish on creation),
// src/api/routes/workitems.ts (publish on transition, via WorkflowService),
// and src/api/routes/incidentStream.ts (subscribe, for SSE).
export const incidentEventPublisher: IncidentEventPublisher = new IncidentEventPublisher(redis, logger);

export const incidentEventSubscriber: IncidentEventSubscriber = new IncidentEventSubscriber(config.redis.url, logger);

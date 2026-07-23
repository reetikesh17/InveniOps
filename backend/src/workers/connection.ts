import { Redis } from "ioredis";
import { config } from "../config/index.js";

// BullMQ's Worker/QueueEvents use blocking Redis commands internally and
// require maxRetriesPerRequest: null on their connection — incompatible
// with the general-purpose `redis` singleton in repositories/clients.ts
// (used by the rate limiter and debouncer, which need normal retry
// behavior for their own non-blocking commands). A dedicated connection,
// shared across the queue/DLQ/worker, avoids the two use cases fighting
// over incompatible settings on one client.
export const queueConnection: Redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

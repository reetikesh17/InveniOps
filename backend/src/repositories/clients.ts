import { PrismaClient } from "@prisma/client";
import { MongoClient, type Db } from "mongodb";
import { Redis } from "ioredis";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

export const prisma = new PrismaClient();

export const mongoClient = new MongoClient(config.mongo.uri);

export const redis = new Redis(config.redis.url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  // Without this, a command queued against a disconnected client waits
  // through ioredis's own reconnection backoff (default up to ~2s per
  // attempt, up to maxRetriesPerRequest attempts) before finally
  // rejecting — several seconds in practice. That directly undermines
  // both the rate limiter's fail-open path (checkRateLimitFailOpen,
  // src/api/routes/signals.ts) and the dashboard cache's degrade-to-
  // Postgres path (CacheUnavailableError, dashboardCache.ts): "fails
  // open" or "degrades gracefully" isn't meaningfully true if it takes
  // multiple seconds to happen. A command that hasn't completed in 2s is
  // certainly not going to on a healthy connection, so this is a strict
  // improvement, not a behavior tradeoff, on the success path.
  commandTimeout: 2_000,
});

let mongoDb: Db | undefined;

export async function connectClients(): Promise<void> {
  await prisma.$connect();
  await mongoClient.connect();
  mongoDb = mongoClient.db();
  await redis.connect();
  logger.info("connected to postgres, mongo, and redis");
}

export function getMongoDb(): Db {
  if (!mongoDb) {
    throw new Error("Mongo client not connected — call connectClients() first");
  }
  return mongoDb;
}

export async function disconnectClients(): Promise<void> {
  await Promise.allSettled([prisma.$disconnect(), mongoClient.close(), redis.quit()]);
  logger.info("disconnected from postgres, mongo, and redis");
}

let shutdownRegistered = false;

/** Registers SIGTERM/SIGINT handlers that run onShutdown, then close all clients. */
export function registerShutdownHooks(onShutdown?: () => Promise<void> | void): void {
  if (shutdownRegistered) {
    return;
  }
  shutdownRegistered = true;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    try {
      await onShutdown?.();
      await disconnectClients();
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

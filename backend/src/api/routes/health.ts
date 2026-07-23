import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma, getMongoDb, redis } from "../../repositories/clients.js";
import type { BufferStats } from "../../services/ingestion/buffer.js";
import { signalBuffer } from "../../services/ingestion/signalBufferInstance.js";

type DependencyStatus = "up" | "down";

interface HealthResponseBody {
  status: "healthy" | "degraded" | "unhealthy";
  dependencies: {
    postgres: DependencyStatus;
    mongo: DependencyStatus;
    redis: DependencyStatus;
  };
  buffer: BufferStats;
}

async function checkPostgres(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

async function checkMongo(): Promise<DependencyStatus> {
  try {
    await getMongoDb().command({ ping: 1 });
    return "up";
  } catch {
    return "down";
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  try {
    const reply = await redis.ping();
    return reply === "PONG" ? "up" : "down";
  } catch {
    return "down";
  }
}

async function handleHealthCheck(res: Response<HealthResponseBody>): Promise<void> {
  const [postgres, mongo, redisStatus] = await Promise.all([
    checkPostgres(),
    checkMongo(),
    checkRedis(),
  ]);

  const dependencies = { postgres, mongo, redis: redisStatus };
  const allUp = Object.values(dependencies).every((status) => status === "up");
  const buffer = signalBuffer.getStats();

  // Shedding isn't a dependency outage — the service is still serving
  // traffic (P0 still gets through), just under pressure. 200, not 503, so
  // load balancers keep routing to it; "degraded" is there for whoever's
  // watching to notice.
  const status = !allUp ? "unhealthy" : buffer.state === "shedding" ? "degraded" : "healthy";

  res.status(allUp ? 200 : 503).json({ status, dependencies, buffer });
}

export const healthRouter = Router();

healthRouter.get(
  "/",
  (_req: Request, res: Response<HealthResponseBody>, next: NextFunction): void => {
    handleHealthCheck(res).catch(next);
  },
);

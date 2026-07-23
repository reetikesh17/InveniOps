import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma, getMongoDb, redis } from "../../repositories/clients.js";

type DependencyStatus = "up" | "down";

interface HealthResponseBody {
  status: "healthy" | "unhealthy";
  dependencies: {
    postgres: DependencyStatus;
    mongo: DependencyStatus;
    redis: DependencyStatus;
  };
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

  res.status(allUp ? 200 : 503).json({
    status: allUp ? "healthy" : "unhealthy",
    dependencies,
  });
}

export const healthRouter = Router();

healthRouter.get(
  "/",
  (_req: Request, res: Response<HealthResponseBody>, next: NextFunction): void => {
    handleHealthCheck(res).catch(next);
  },
);

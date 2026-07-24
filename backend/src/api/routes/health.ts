import { Router, type Request, type Response } from "express";
import type { BufferStats } from "../../services/ingestion/buffer.js";
import { signalBuffer } from "../../services/ingestion/signalBufferInstance.js";
import { getLastSignalsPerSecond } from "../../utils/metrics.js";
import { appVersion } from "../../utils/version.js";
import { dependencyHealthProbe, queueDepthProbe, type HealthSnapshot, type QueueDepthSnapshot } from "../../services/observability/healthProbeInstance.js";

type DependencyStatus = "up" | "down";

interface DependencyHealthDto {
  readonly status: DependencyStatus;
  readonly latencyMs: number;
}

export interface HealthResponseBody {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly uptimeSeconds: number;
  readonly version: string;
  readonly dependencies: Readonly<Record<"postgres" | "mongo" | "redis" | "queue", DependencyHealthDto>>;
  readonly buffer: {
    readonly depth: number;
    readonly capacity: number;
    readonly fillFraction: number;
    readonly shedding: boolean;
  };
  readonly queue: QueueDepthSnapshot;
  readonly throughput: {
    readonly signalsPerSecond: number;
  };
}

export interface BuildHealthResponseInput {
  readonly dependencies: HealthSnapshot;
  readonly queueDepth: QueueDepthSnapshot;
  readonly bufferStats: BufferStats;
  readonly uptimeSeconds: number;
  readonly version: string;
  readonly signalsPerSecond: number;
}

/**
 * Pure — every input is already a plain value, no I/O, so this is
 * independently unit-testable against fabricated snapshots without
 * standing up real Postgres/Mongo/Redis/BullMQ (see
 * tests/unit/api/routes/health.test.ts for the "each dependency down"
 * cases). The route handler below is a thin wrapper that supplies real
 * (cached) values.
 *
 * Shedding is not a dependency outage — the service is still serving
 * traffic (P0 still gets through), just under pressure: 200, not 503, so
 * a load balancer keeps routing to it; "degraded" is there for whoever's
 * watching to notice. 503 is reserved for "a critical dependency is
 * actually unreachable."
 */
export function buildHealthResponse(input: BuildHealthResponseInput): { httpStatus: number; body: HealthResponseBody } {
  const { dependencies } = input;
  const allUp =
    dependencies.postgres.status === "up" &&
    dependencies.mongo.status === "up" &&
    dependencies.redis.status === "up" &&
    dependencies.queue.status === "up";

  const status = !allUp ? "unhealthy" : input.bufferStats.state === "shedding" ? "degraded" : "healthy";

  return {
    httpStatus: allUp ? 200 : 503,
    body: {
      status,
      uptimeSeconds: input.uptimeSeconds,
      version: input.version,
      dependencies,
      buffer: {
        depth: input.bufferStats.totalSize,
        capacity: input.bufferStats.capacity,
        fillFraction: input.bufferStats.fillFraction,
        shedding: input.bufferStats.state === "shedding",
      },
      queue: input.queueDepth,
      throughput: { signalsPerSecond: input.signalsPerSecond },
    },
  };
}

function handleHealthCheck(res: Response<HealthResponseBody>): void {
  // Every input here is a synchronous, in-memory read (a cached probe
  // snapshot or a plain counter) — this handler can never block on a
  // slow or hanging dependency, by construction, not by convention.
  const { httpStatus, body } = buildHealthResponse({
    dependencies: dependencyHealthProbe.get(),
    queueDepth: queueDepthProbe.get(),
    bufferStats: signalBuffer.getStats(),
    uptimeSeconds: process.uptime(),
    version: appVersion,
    signalsPerSecond: getLastSignalsPerSecond(),
  });
  res.status(httpStatus).json(body);
}

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response<HealthResponseBody>): void => {
  handleHealthCheck(res);
});

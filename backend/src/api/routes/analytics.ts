import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma, getMongoDb } from "../../repositories/clients.js";
import { PostgresWorkItemRepository } from "../../repositories/postgres/index.js";
import { MongoMetricsRepository } from "../../repositories/metrics/index.js";
import {
  AnalyticsQueryService,
  type ComponentHealthDto,
  type IncidentCountsResponseDto,
  type MttrTrendResponseDto,
  type ThroughputResponseDto,
} from "../../services/aggregation/analyticsService.js";

let analyticsService: AnalyticsQueryService | undefined;

/**
 * Lazy, memoized — same reasoning as src/api/routes/workitems.ts's
 * getServices(): MongoMetricsRepository needs a live Mongo connection,
 * which only exists after src/index.ts's connectClients() has resolved,
 * always true by the time the server accepts its first request.
 */
function getService(): AnalyticsQueryService {
  if (!analyticsService) {
    analyticsService = new AnalyticsQueryService(
      new MongoMetricsRepository(getMongoDb()),
      new PostgresWorkItemRepository(prisma),
    );
  }
  return analyticsService;
}

const rangeQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  interval: z.coerce.number().int().positive().default(60),
});

const groupByQuerySchema = rangeQuerySchema.extend({
  groupBy: z.enum(["componentType", "severity"]).default("componentType"),
});

const componentHealthQuerySchema = z.object({
  windowSeconds: z.coerce.number().int().positive().default(3_600),
});

interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
}

function badRequest(res: Response<ErrorResponseBody>, message: string): void {
  res.status(400).json({ error: "validation_error", message });
}

async function handleThroughput(req: Request, res: Response<ThroughputResponseDto | ErrorResponseBody>): Promise<void> {
  const parsed = rangeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "from, to (dates) and interval (positive integer seconds) are required");
    return;
  }
  const { from, to, interval } = parsed.data;
  res.status(200).json(await getService().getThroughput(from, to, interval));
}

async function handleIncidents(req: Request, res: Response<IncidentCountsResponseDto | ErrorResponseBody>): Promise<void> {
  const parsed = groupByQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "from, to (dates), interval (positive integer seconds), and groupBy (componentType|severity) are required");
    return;
  }
  const { from, to, interval, groupBy } = parsed.data;
  res.status(200).json(await getService().getIncidentCounts(from, to, interval, groupBy));
}

async function handleMttr(req: Request, res: Response<MttrTrendResponseDto | ErrorResponseBody>): Promise<void> {
  const parsed = groupByQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "from, to (dates), interval (positive integer seconds), and groupBy (componentType|severity) are required");
    return;
  }
  const { from, to, interval, groupBy } = parsed.data;
  res.status(200).json(await getService().getMttrTrend(from, to, interval, groupBy));
}

async function handleComponentHealth(req: Request, res: Response<ComponentHealthDto | ErrorResponseBody>): Promise<void> {
  const { id } = req.params;
  if (!id) {
    badRequest(res, "component id is required");
    return;
  }
  const parsed = componentHealthQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "windowSeconds must be a positive integer");
    return;
  }
  res.status(200).json(await getService().getComponentHealth(id, parsed.data.windowSeconds));
}

export const analyticsRouter = Router();

analyticsRouter.get(
  "/throughput",
  (req: Request, res: Response<ThroughputResponseDto | ErrorResponseBody>, next: NextFunction): void => {
    handleThroughput(req, res).catch(next);
  },
);

analyticsRouter.get(
  "/incidents",
  (req: Request, res: Response<IncidentCountsResponseDto | ErrorResponseBody>, next: NextFunction): void => {
    handleIncidents(req, res).catch(next);
  },
);

analyticsRouter.get(
  "/mttr",
  (req: Request, res: Response<MttrTrendResponseDto | ErrorResponseBody>, next: NextFunction): void => {
    handleMttr(req, res).catch(next);
  },
);

analyticsRouter.get(
  "/components/:id",
  (req: Request, res: Response<ComponentHealthDto | ErrorResponseBody>, next: NextFunction): void => {
    handleComponentHealth(req, res).catch(next);
  },
);

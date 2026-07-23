import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { prisma, getMongoDb, redis } from "../../repositories/clients.js";
import { PostgresWorkItemRepository } from "../../repositories/postgres/index.js";
import { MongoSignalRepository } from "../../repositories/mongo/signalRepository.js";
import { DashboardCacheRepository, type IncidentSummary } from "../../repositories/redis/dashboardCache.js";
import {
  DashboardProjectionService,
  toIncidentSummary,
  type IncidentDetailDto,
  type SignalDto,
} from "../../services/dashboard/dashboardProjection.js";
import { WorkflowService } from "../../services/workitems/workflowService.js";

interface Services {
  readonly dashboard: DashboardProjectionService;
  readonly workflow: WorkflowService;
}

let services: Services | undefined;

/**
 * Constructed lazily, on first request — not at module load. These
 * repositories need a live Mongo connection (getMongoDb() throws until
 * connectClients() has resolved in src/index.ts's bootstrap), which
 * happens *after* this module is imported (ES module imports are hoisted
 * ahead of any of index.ts's own code) but always before the server
 * starts accepting requests. Memoized so repeated requests reuse the same
 * thin wrapper instances rather than reconstructing them each time.
 */
function getServices(): Services {
  if (!services) {
    const workItemStore = new PostgresWorkItemRepository(prisma);
    const signalStore = new MongoSignalRepository(getMongoDb());
    const cache = new DashboardCacheRepository(redis, config.dashboard.cacheTtlSeconds);

    services = {
      dashboard: new DashboardProjectionService(workItemStore, signalStore, cache, {
        repopulateCap: config.dashboard.repopulateCap,
      }),
      workflow: new WorkflowService(workItemStore, cache),
    };
  }
  return services;
}

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(config.dashboard.listMaxLimit).default(config.dashboard.listDefaultLimit),
  offset: z.coerce.number().int().min(0).default(0),
});

const transitionBodySchema = z.object({
  toState: z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"]),
  actor: z.string().min(1).max(200),
});

const rcaActorSchema = z.object({
  actor: z.string().min(1).max(200),
});

interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
  readonly errors?: readonly { readonly field: string; readonly message: string }[];
}

interface PageResponseBody<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

type IncidentResponseBody = IncidentSummary | ErrorResponseBody;
type IncidentDetailResponseBody = IncidentDetailDto | ErrorResponseBody;
type IncidentListResponseBody = PageResponseBody<IncidentSummary> | ErrorResponseBody;
type SignalsResponseBody = PageResponseBody<SignalDto> | ErrorResponseBody;
type RcaResponseBody = (IncidentSummary & { readonly mttrSeconds: number }) | ErrorResponseBody;

async function handleListIncidents(req: Request, res: Response<IncidentListResponseBody>): Promise<void> {
  const parsed = paginationQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: "invalid pagination parameters" });
    return;
  }

  const { limit, offset } = parsed.data;
  const page = await getServices().dashboard.getActiveIncidents({ limit, offset });
  res.status(200).json({ items: page.items, total: page.total, limit, offset });
}

async function handleGetIncident(req: Request, res: Response<IncidentDetailResponseBody>): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "validation_error", message: "incident id is required" });
    return;
  }

  const detail = await getServices().dashboard.getIncidentDetail(id);
  if (!detail) {
    res.status(404).json({ error: "not_found", message: `No incident with id ${id}` });
    return;
  }

  res.status(200).json(detail);
}

async function handleGetIncidentSignals(req: Request, res: Response<SignalsResponseBody>): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "validation_error", message: "incident id is required" });
    return;
  }

  const parsedQuery = paginationQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "validation_error", message: "invalid pagination parameters" });
    return;
  }

  const { limit, offset } = parsedQuery.data;
  const page = await getServices().dashboard.getIncidentSignals(id, { limit, offset });
  if (!page) {
    res.status(404).json({ error: "not_found", message: `No incident with id ${id}` });
    return;
  }

  res.status(200).json({ items: page.items, total: page.total, limit, offset });
}

async function handleTransition(req: Request, res: Response<IncidentResponseBody>): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "validation_error", message: "incident id is required" });
    return;
  }

  const parsedBody = transitionBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: "validation_error",
      message: "invalid transition request",
      errors: parsedBody.error.issues.map((issue) => ({ field: issue.path.join(".") || "(root)", message: issue.message })),
    });
    return;
  }

  const outcome = await getServices().workflow.transitionWorkItem(id, parsedBody.data.toState, parsedBody.data.actor);

  switch (outcome.outcome) {
    case "not_found":
      res.status(404).json({ error: "not_found", message: `No incident with id ${id}` });
      return;
    case "invalid_transition":
      res.status(409).json({ error: "invalid_transition", message: outcome.message });
      return;
    case "conflict":
      res.status(409).json({ error: "conflict", message: outcome.message });
      return;
    case "transitioned":
      res.status(200).json(toIncidentSummary(outcome.workItem));
      return;
  }
}

async function handleSubmitRca(req: Request, res: Response<RcaResponseBody>): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "validation_error", message: "incident id is required" });
    return;
  }

  const parsedActor = rcaActorSchema.safeParse(req.body);
  if (!parsedActor.success) {
    res.status(400).json({ error: "validation_error", message: "actor is required" });
    return;
  }

  // RCA field validation itself is handled downstream by the domain layer
  // (src/domain/rca/validateRca.ts, invoked via WorkflowService) — that's
  // what produces the field-level errors for the 422 response, and it's
  // deliberately the single source of truth for what makes an RCA valid,
  // not a second, possibly-drifting copy of the same rules at this layer.
  const outcome = await getServices().workflow.submitIncidentRca(id, req.body, parsedActor.data.actor);

  switch (outcome.outcome) {
    case "not_found":
      res.status(404).json({ error: "not_found", message: `No incident with id ${id}` });
      return;
    case "invalid_rca":
      res.status(422).json({ error: "invalid_rca", message: "RCA failed validation", errors: outcome.errors });
      return;
    case "invalid_state":
      res.status(409).json({ error: "invalid_state", message: outcome.message });
      return;
    case "closed":
      res.status(200).json({ ...toIncidentSummary(outcome.workItem), mttrSeconds: outcome.mttrSeconds });
      return;
  }
}

export const workitemsRouter = Router();

workitemsRouter.get("/", (req: Request, res: Response<IncidentListResponseBody>, next: NextFunction): void => {
  handleListIncidents(req, res).catch(next);
});

workitemsRouter.get("/:id", (req: Request, res: Response<IncidentDetailResponseBody>, next: NextFunction): void => {
  handleGetIncident(req, res).catch(next);
});

workitemsRouter.get(
  "/:id/signals",
  (req: Request, res: Response<SignalsResponseBody>, next: NextFunction): void => {
    handleGetIncidentSignals(req, res).catch(next);
  },
);

workitemsRouter.post(
  "/:id/transition",
  (req: Request, res: Response<IncidentResponseBody>, next: NextFunction): void => {
    handleTransition(req, res).catch(next);
  },
);

workitemsRouter.post("/:id/rca", (req: Request, res: Response<RcaResponseBody>, next: NextFunction): void => {
  handleSubmitRca(req, res).catch(next);
});

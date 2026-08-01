import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import cors from "cors";
import { httpLogger } from "../utils/logger.js";
import { healthRouter } from "./routes/health.js";
import { readyRouter } from "./routes/ready.js";
import { metricsRouter } from "./routes/metrics.js";
import { signalsRouter } from "./routes/signals.js";
import { workitemsRouter } from "./routes/workitems.js";
import { incidentStreamRouter } from "./routes/incidentStream.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(httpLogger);

  // Public, deliberately: /health, /ready, and /metrics are infrastructure
  // endpoints (load balancer probes, scrapers), and signal ingestion is
  // machine-to-machine (monitoring agents posting signals, not a logged-in
  // human at a browser). If ingestion is ever locked down, the right
  // mechanism is API keys/service credentials issued to those agents, not
  // user JWTs — a different trust boundary from everything below this
  // comment. That's a real design decision, not an oversight.
  app.use("/health", healthRouter);
  app.use("/ready", readyRouter);
  app.use("/metrics", metricsRouter);
  app.use("/api/v1/signals", signalsRouter);
  app.use("/api/v1/auth", authRouter);

  // Everything below serves a logged-in human at the dashboard — behind
  // requireAuth. incidentStreamRouter verifies its own token instead (see
  // its handler's comment): EventSource can't set an Authorization header.
  // Mounted before workitemsRouter: both share the "/api/v1/incidents"
  // base, and workitemsRouter's "GET /:id" would otherwise swallow
  // "GET /stream" as an :id of "stream" if it were checked first. Express
  // tries routers in registration order.
  app.use("/api/v1/incidents", incidentStreamRouter);
  app.use("/api/v1/incidents", requireAuth, workitemsRouter);
  app.use("/api/v1/analytics", requireAuth, analyticsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
}

interface ErrorResponseBody {
  error: string;
  message: string;
}

function errorHandler(
  err: unknown,
  req: Request,
  res: Response<ErrorResponseBody>,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  // body-parser throws a SyntaxError with status 400 for malformed JSON
  // bodies — surface that as a client error, not a 500.
  if (err instanceof SyntaxError && (err as SyntaxError & { status?: number }).status === 400) {
    res.status(400).json({ error: "invalid_json", message: "request body is not valid JSON" });
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected error";
  req.log.error({ err }, "unhandled error");

  res.status(500).json({ error: "internal_error", message });
}

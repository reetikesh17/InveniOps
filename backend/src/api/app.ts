import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import cors from "cors";
import { httpLogger } from "../utils/logger.js";
import { healthRouter } from "./routes/health.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(httpLogger);

  app.use("/health", healthRouter);

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

function errorHandler(err: unknown, req: Request, res: Response<ErrorResponseBody>, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected error";
  req.log.error({ err }, "unhandled error");

  res.status(500).json({ error: "internal_error", message });
}

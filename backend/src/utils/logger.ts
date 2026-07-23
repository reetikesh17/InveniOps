import { randomUUID } from "node:crypto";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { config } from "../config/index.js";

export const logger = pino({
  level: config.env === "production" ? "info" : "debug",
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    if (typeof existing === "string" && existing.length > 0) {
      return existing;
    }
    const id = randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
});

import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { ComponentType, Severity } from "@prisma/client";
import { z } from "zod";
import { config } from "../../config/index.js";
import { redis } from "../../repositories/clients.js";
import { throughputCounter, signalCounters } from "../../utils/metrics.js";
import type { IngestionSignal } from "../../services/ingestion/buffer.js";
import { signalBuffer } from "../../services/ingestion/signalBufferInstance.js";
import { checkTokenBuckets, secondsUntilAvailable, type TokenBucketResult } from "../../rateLimit/tokenBucket.js";
import { parseSignalBatch, type ValidationFieldError } from "./signalValidation.js";
import { pickSeverityForComponentType } from "./syntheticSeverity.js";

interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
  readonly details?: readonly ValidationFieldError[];
  readonly accepted?: number;
  readonly dropped?: number;
}

interface IngestResponseBody {
  readonly accepted: number;
  readonly signalIds?: readonly string[];
}

function setRateLimitHeaders(res: Response, result: TokenBucketResult): void {
  res.setHeader("RateLimit-Limit", String(result.ip.capacity));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, Math.floor(result.ip.remaining))));
  res.setHeader(
    "RateLimit-Reset",
    String(secondsUntilAvailable(result.ip, config.rateLimit.ip.refillPerSecond, result.ip.capacity)),
  );
}

/**
 * Submits every signal to the in-memory buffer (src/services/ingestion/buffer.ts).
 * If any of them were dropped (shed under backpressure, or the buffer is at
 * hard capacity), the whole request is rejected with 503 — the ones that
 * did get in are already safely buffered, so a retry of the full batch is
 * safe, if possibly duplicative. Returns the accepted subset, or undefined
 * if a 503 was already sent.
 */
function submitOrReject(
  res: Response<IngestResponseBody | ErrorResponseBody>,
  signals: readonly IngestionSignal[],
): readonly IngestionSignal[] | undefined {
  const accepted: IngestionSignal[] = [];
  let dropped = 0;

  for (const signal of signals) {
    const result = signalBuffer.submit(signal);
    if (result.accepted) {
      accepted.push(signal);
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    res.status(503).json({
      error: "buffer_saturated",
      message: "ingestion buffer is saturated, try again shortly",
      accepted: accepted.length,
      dropped,
    });
    return undefined;
  }

  return accepted;
}

async function handleIngest(
  req: Request,
  res: Response<IngestResponseBody | ErrorResponseBody>,
): Promise<void> {
  const parsed = parseSignalBatch(req.body, config.ingestion.maxBatchSize);

  if (!parsed.ok) {
    if (parsed.reason === "validation_failed") {
      res
        .status(400)
        .json({ error: "validation_error", message: "one or more signals failed validation", details: parsed.errors });
      return;
    }
    res.status(400).json({ error: "validation_error", message: parsed.message, details: [] });
    return;
  }

  const cost = parsed.signals.length;
  const rateLimitResult = await checkTokenBuckets(redis, {
    ipKey: `ratelimit:signals:ip:${req.ip}`,
    globalKey: "ratelimit:signals:global",
    ip: config.rateLimit.ip,
    global: config.rateLimit.global,
    cost,
  });

  setRateLimitHeaders(res, rateLimitResult);

  if (!rateLimitResult.allowed) {
    const limitedByGlobal = rateLimitResult.limitedBy === "global";
    const limitedBucket = limitedByGlobal ? rateLimitResult.global : rateLimitResult.ip;
    const refillPerSecond = limitedByGlobal
      ? config.rateLimit.global.refillPerSecond
      : config.rateLimit.ip.refillPerSecond;

    res.setHeader("Retry-After", String(secondsUntilAvailable(limitedBucket, refillPerSecond, cost)));
    res.status(429).json({
      error: "rate_limited",
      message: `rate limit exceeded (${rateLimitResult.limitedBy ?? "unknown"})`,
    });
    return;
  }

  const receivedAt = new Date();
  const correlationId = String(req.id);
  const ingestionSignals: IngestionSignal[] = parsed.signals.map((signal) => ({
    signalId: signal.signalId ?? randomUUID(),
    componentId: signal.componentId,
    componentType: signal.componentType,
    severity: signal.severity,
    rawPayload: signal.rawPayload,
    occurredAt: signal.occurredAt,
    receivedAt,
    correlationId,
  }));
  for (const signal of ingestionSignals) {
    signalCounters.recordReceived(signal.severity);
  }

  const accepted = submitOrReject(res, ingestionSignals);
  if (!accepted) {
    return;
  }

  for (const signal of accepted) {
    signalCounters.recordAccepted(signal.severity);
  }
  throughputCounter.increment(accepted.length);

  res.status(202).json({
    accepted: accepted.length,
    signalIds: accepted.map((signal) => signal.signalId),
  });
}

const bulkTestInputSchema = z.object({
  count: z.coerce.number().int().positive(),
  componentId: z.string().min(1).max(200).optional(),
  componentType: z.nativeEnum(ComponentType).optional(),
  severity: z.nativeEnum(Severity).optional(),
});

interface SyntheticOverrides {
  readonly componentId: string | undefined;
  readonly componentType: ComponentType | undefined;
  readonly severity: Severity | undefined;
}

const COMPONENT_TYPES = Object.values(ComponentType);

// A fixed pool of synthetic components: SYNTHETIC_COMPONENT_SLOTS / 6 per
// type (20 each at 120). A component's (type, id, characteristic severity)
// are all a pure function of its slot, so they never change between signals
// or between bulk-test calls.
const SYNTHETIC_COMPONENT_SLOTS = 120;

/**
 * Every synthetic component has ONE characteristic failure severity for its
 * whole burst — a Cache component is a P2 component, an RDBMS is a P0
 * component. This matters: signals within a burst are NOT independently
 * drawn, because the ingestion buffer prioritises higher severities under
 * backpressure, so a component fed ~dozens of independent draws would almost
 * always see one P0 and have its work item created as P0 — every type would
 * converge to P0 and the Strategy pattern would look broken all over again.
 *
 * Instead each component's severity is an even quantile across its type's mix
 * (see syntheticSeverity.ts): rank r of ranksPerType maps to quantile
 * (r + 0.5) / ranksPerType. Spread over a type's components this reproduces
 * the mix's proportions — modal at the type's strategy floor (RDBMS mostly
 * P0, Cache mostly P2) — while keeping each individual component stable.
 */
function generateSyntheticSignal(index: number, overrides: SyntheticOverrides, now: Date, correlationId: string): IngestionSignal {
  const numTypes = COMPONENT_TYPES.length;
  const ranksPerType = Math.max(1, Math.floor(SYNTHETIC_COMPONENT_SLOTS / numTypes));
  const slot = index % SYNTHETIC_COMPONENT_SLOTS;
  const componentType = overrides.componentType ?? COMPONENT_TYPES[slot % numTypes] ?? ComponentType.API;
  const rank = Math.floor(slot / numTypes) % ranksPerType;

  return {
    signalId: randomUUID(),
    // componentId encodes its type (CACHE_1, RDBMS_3, …) and stays fixed.
    componentId: overrides.componentId ?? `${componentType}_${rank + 1}`,
    componentType,
    // Deterministic per-component severity from the type's mix — an explicit
    // override still wins.
    severity: overrides.severity ?? pickSeverityForComponentType(componentType, () => (rank + 0.5) / ranksPerType),
    rawPayload: { synthetic: true, index },
    occurredAt: now,
    receivedAt: now,
    correlationId,
  };
}

/**
 * Generates signals in-process instead of accepting them over the network —
 * for load-testing the ingestion pipeline without a load generator hitting
 * the wire. Deliberately bypasses the token-bucket rate limiter (that
 * protects against network-sourced abuse, which this isn't) and the normal
 * per-request batch cap (governed instead by its own, much larger, ceiling).
 */
function handleBulkTest(req: Request, res: Response<IngestResponseBody | ErrorResponseBody>): void {
  const parsedInput = bulkTestInputSchema.safeParse(req.body);

  if (!parsedInput.success) {
    res.status(400).json({
      error: "validation_error",
      message: "invalid bulk-test request",
      details: parsedInput.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    });
    return;
  }

  const { count, componentId, componentType, severity } = parsedInput.data;

  if (count > config.ingestion.bulkTestMaxCount) {
    res.status(400).json({
      error: "validation_error",
      message: `count ${count} exceeds maximum of ${config.ingestion.bulkTestMaxCount}`,
      details: [],
    });
    return;
  }

  const now = new Date();
  const correlationId = String(req.id);
  const signals = Array.from({ length: count }, (_, index) =>
    generateSyntheticSignal(index, { componentId, componentType, severity }, now, correlationId),
  );
  for (const signal of signals) {
    signalCounters.recordReceived(signal.severity);
  }

  const accepted = submitOrReject(res, signals);
  if (!accepted) {
    return;
  }

  for (const signal of accepted) {
    signalCounters.recordAccepted(signal.severity);
  }
  throughputCounter.increment(accepted.length);

  res.status(202).json({ accepted: accepted.length });
}

export const signalsRouter = Router();

signalsRouter.post(
  "/",
  (req: Request, res: Response<IngestResponseBody | ErrorResponseBody>, next: NextFunction): void => {
    handleIngest(req, res).catch(next);
  },
);

if (config.env !== "production") {
  signalsRouter.post("/bulk-test", handleBulkTest);
}

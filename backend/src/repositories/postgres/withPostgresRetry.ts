import { retry } from "../../utils/retry.js";
import { logger } from "../../utils/logger.js";
import { isTransientPrismaError } from "./prismaErrors.js";

// Short and few — this recovers brief blips (a deadlock, a momentary pool
// exhaustion), not a real outage. If it's still failing after 3 quick
// attempts, retrying further just delays surfacing the failure.
const ATTEMPTS = 3;
const BASE_DELAY_MS = 50;

/**
 * Every retry is logged (attempt number, the delay before it, and the
 * error that triggered it) — without this, a real outage produces zero
 * visible evidence that the retry wrapper engaged at all before the
 * caller's error propagates. See tests/chaos/postgresOutage.test.ts, which
 * asserts on these log lines directly.
 */
export function withPostgresRetry<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, {
    attempts: ATTEMPTS,
    baseDelayMs: BASE_DELAY_MS,
    shouldRetry: isTransientPrismaError,
    onRetry: (error, attempt, delayMs) => {
      const code = error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined;
      logger.warn(
        { attempt, maxAttempts: ATTEMPTS, delayMs, errorCode: code, error: error instanceof Error ? error.message : String(error) },
        "retrying postgres operation after a transient error",
      );
    },
  });
}

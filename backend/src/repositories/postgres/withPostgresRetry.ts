import { retry } from "../../utils/retry.js";
import { isTransientPrismaError } from "./prismaErrors.js";

// Short and few — this recovers brief blips (a deadlock, a momentary pool
// exhaustion), not a real outage. If it's still failing after 3 quick
// attempts, retrying further just delays surfacing the failure.
const ATTEMPTS = 3;
const BASE_DELAY_MS = 50;

export function withPostgresRetry<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, {
    attempts: ATTEMPTS,
    baseDelayMs: BASE_DELAY_MS,
    shouldRetry: isTransientPrismaError,
  });
}

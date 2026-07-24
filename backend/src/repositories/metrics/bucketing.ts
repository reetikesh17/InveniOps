import type { BucketSpec } from "./types.js";

/**
 * Converts a query param expressed the way a caller naturally thinks about
 * it — "bucket every N seconds" — into the {unit, binSize} shape
 * MongoDB's $dateTrunc wants, picking the largest whole unit that divides
 * evenly so buckets land on natural boundaries (e.g. 3600 -> 1 hour, not
 * 3600 one-second bins truncated to the same result the hard way).
 */
export function toBucketSpec(intervalSeconds: number): BucketSpec {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error(`interval must be a positive integer number of seconds, got ${intervalSeconds}`);
  }
  if (intervalSeconds % 86_400 === 0) {
    return { unit: "day", binSize: intervalSeconds / 86_400 };
  }
  if (intervalSeconds % 3_600 === 0) {
    return { unit: "hour", binSize: intervalSeconds / 3_600 };
  }
  if (intervalSeconds % 60 === 0) {
    return { unit: "minute", binSize: intervalSeconds / 60 };
  }
  return { unit: "second", binSize: intervalSeconds };
}

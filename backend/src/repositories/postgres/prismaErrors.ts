import { Prisma } from "@prisma/client";

// Prisma error codes that represent transient conditions worth retrying —
// a brief network blip, a momentary connection-pool exhaustion, or a
// deadlock/serialization conflict Prisma's own docs say to retry. Every
// other known code (constraint violations, not-found, validation errors)
// means "this exact call will fail again," so retrying wastes time and
// delays surfacing a real problem.
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "P1001", // Can't reach database server
  "P1002", // Reached the server, but it timed out
  "P1008", // Operation timed out
  "P1017", // Server closed the connection
  "P2024", // Timed out fetching a connection from the pool
  "P2034", // Write conflict or deadlock — Prisma's docs recommend retrying this one
]);

export function isTransientPrismaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_ERROR_CODES.has(error.code);
  }
  // PrismaClientValidationError, PrismaClientRustPanicError, unknown
  // errors, and any PrismaClientKnownRequestError code not in the
  // allow-list above (P2002 unique violation, P2003 FK violation, P2025
  // not found, etc.) are all treated as non-transient — fail closed rather
  // than retry something we can't positively classify as safe to retry.
  return false;
}

/**
 * True for a P2002 unique-violation whose target includes the given index
 * name. Used by the debouncer (src/services/ingestion/debouncer.ts) to
 * recognize "another worker already created the active work item for this
 * component" — expected, correct-path contention, not a real failure — as
 * distinct from any other unique-constraint violation.
 */
export function isUniqueConstraintViolation(error: unknown, indexName: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.["target"];
  if (typeof target === "string") {
    return target.includes(indexName);
  }
  if (Array.isArray(target)) {
    return target.includes(indexName);
  }
  // Some drivers/versions omit meta.target entirely for raw-SQL-created
  // indexes (this one isn't expressible in schema.prisma) — a P2002 on
  // work_items with no target info is still overwhelmingly likely to be
  // this index, since it's the only unique constraint create/insert paths
  // on this table can hit. Treat it as a match rather than as unclassified.
  return target === undefined;
}

import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  isTransientPrismaError,
  isUniqueConstraintViolation,
} from "../../../../src/repositories/postgres/prismaErrors.js";

const CLIENT_VERSION = "5.16.1";

function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`mock ${code}`, {
    code,
    clientVersion: CLIENT_VERSION,
    meta,
  });
}

describe("isTransientPrismaError", () => {
  // The exact set src/repositories/postgres/prismaErrors.ts classifies as
  // transient — a P2034 not appearing here (or an extra code appearing)
  // means the allow-list in that module has drifted from what's documented.
  const TRANSIENT_CODES = ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"];
  const NON_TRANSIENT_CODES = ["P2002", "P2003", "P2025", "P2000", "P2011"];

  it.each(TRANSIENT_CODES)("treats %s as transient (retry)", (code) => {
    expect(isTransientPrismaError(knownError(code))).toBe(true);
  });

  it.each(NON_TRANSIENT_CODES)("treats %s as non-transient (do not retry)", (code) => {
    expect(isTransientPrismaError(knownError(code))).toBe(false);
  });

  it("treats a connection-failure code (P1001, can't reach the database server) as transient", () => {
    expect(isTransientPrismaError(knownError("P1001"))).toBe(true);
  });

  it("treats a deadlock/serialization-conflict code (P2034) as transient", () => {
    expect(isTransientPrismaError(knownError("P2034"))).toBe(true);
  });

  it("treats a unique-constraint violation (P2002) as non-transient", () => {
    expect(isTransientPrismaError(knownError("P2002"))).toBe(false);
  });

  it("treats PrismaClientInitializationError as transient regardless of code", () => {
    const error = new Prisma.PrismaClientInitializationError("cannot connect", CLIENT_VERSION);
    expect(isTransientPrismaError(error)).toBe(true);
  });

  it("treats PrismaClientValidationError as non-transient — retrying a malformed query never succeeds", () => {
    const error = new Prisma.PrismaClientValidationError("invalid `where` argument", {
      clientVersion: CLIENT_VERSION,
    });
    expect(isTransientPrismaError(error)).toBe(false);
  });

  it("treats a plain, non-Prisma Error as non-transient — fail closed on anything unclassified", () => {
    expect(isTransientPrismaError(new Error("something else went wrong"))).toBe(false);
  });

  it("treats a non-Error thrown value as non-transient", () => {
    expect(isTransientPrismaError("a string was thrown")).toBe(false);
    expect(isTransientPrismaError(undefined)).toBe(false);
    expect(isTransientPrismaError(null)).toBe(false);
  });
});

describe("isUniqueConstraintViolation", () => {
  it("matches a P2002 whose string meta.target equals the index name", () => {
    const error = knownError("P2002", { target: "idx_work_items_active_component_id" });
    expect(isUniqueConstraintViolation(error, "idx_work_items_active_component_id")).toBe(true);
  });

  it("matches a P2002 whose array meta.target includes the index name", () => {
    const error = knownError("P2002", { target: ["component_id", "idx_work_items_active_component_id"] });
    expect(isUniqueConstraintViolation(error, "idx_work_items_active_component_id")).toBe(true);
  });

  it("does not match a P2002 on a different index", () => {
    const error = knownError("P2002", { target: "idx_something_else" });
    expect(isUniqueConstraintViolation(error, "idx_work_items_active_component_id")).toBe(false);
  });

  it("treats a P2002 with no meta.target at all as a match (driver-omitted target)", () => {
    const error = knownError("P2002");
    expect(isUniqueConstraintViolation(error, "idx_work_items_active_component_id")).toBe(true);
  });

  it("does not match a non-P2002 known error code", () => {
    const error = knownError("P2003", { target: "idx_work_items_active_component_id" });
    expect(isUniqueConstraintViolation(error, "idx_work_items_active_component_id")).toBe(false);
  });

  it("does not match a non-Prisma error", () => {
    expect(isUniqueConstraintViolation(new Error("nope"), "idx_work_items_active_component_id")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ComponentType, Severity, WorkItemStatus } from "@prisma/client";
import { ROOT_CAUSE_CATEGORIES as BACKEND_ROOT_CAUSE_CATEGORIES } from "../../src/domain/rca/types.js";
import {
  SEVERITIES,
  COMPONENT_TYPES,
  WORK_ITEM_STATES,
  ROOT_CAUSE_CATEGORIES,
} from "../../../frontend/src/types/enums";

/**
 * This is the drift-prevention mechanism for the frontend's hand-written
 * enums (see frontend/src/types/enums.ts's own comment) — not codegen, not
 * a shared package, just a plain relative import across the one physical
 * repo both directories live in, checked on every `npm test` run here.
 * Order-sensitive: Severity's ranking (P0 most severe) is meaningful, not
 * just its membership, and this catches a reordering just as loudly as a
 * missing/extra value.
 */
describe("frontend/src/types/enums.ts parity with the backend", () => {
  it("Severity matches @prisma/client's Severity enum, in rank order", () => {
    expect(SEVERITIES).toEqual(Object.values(Severity));
  });

  it("ComponentType matches @prisma/client's ComponentType enum", () => {
    expect(COMPONENT_TYPES).toEqual(Object.values(ComponentType));
  });

  it("WorkItemState matches @prisma/client's WorkItemStatus enum", () => {
    expect(WORK_ITEM_STATES).toEqual(Object.values(WorkItemStatus));
  });

  it("RootCauseCategory matches domain/rca/types.ts's ROOT_CAUSE_CATEGORIES — the actual runtime source of truth for RCA validation", () => {
    expect(ROOT_CAUSE_CATEGORIES).toEqual(BACKEND_ROOT_CAUSE_CATEGORIES);
  });
});

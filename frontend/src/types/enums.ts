// Single source of truth on the frontend for the backend's Prisma enums and
// the RCA root-cause category list. Parity with the backend is enforced by
// a checked test, not by codegen or a shared package — see
// backend/tests/unit/frontendTypesParity.test.ts, which imports these
// arrays directly (this repo is one physical checkout, so that's a plain
// relative import, not a package dependency) and asserts exact,
// order-sensitive equality against @prisma/client's enums and against
// domain/rca/types.ts's ROOT_CAUSE_CATEGORIES. If these ever drift from the
// backend, that test fails the backend's own `npm test` — see
// docs/decisions/ for why this was chosen over codegen or a monorepo
// package for this project's scope.

// Order matters: P0 is the most severe. Mirrors prisma/schema.prisma's
// `enum Severity`.
export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Mirrors prisma/schema.prisma's `enum ComponentType`.
export const COMPONENT_TYPES = ["API", "MCP_HOST", "CACHE", "QUEUE", "RDBMS", "NOSQL"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

// Mirrors prisma/schema.prisma's `enum WorkItemStatus` — named WorkItemState
// here to match the domain-layer name used throughout the backend's
// src/domain/state/ (see README's Design Patterns section).
export const WORK_ITEM_STATES = ["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

// Mirrors backend/src/domain/rca/types.ts's ROOT_CAUSE_CATEGORIES — that
// file, not the Prisma schema, is the actual runtime source of truth for
// RCA validation (src/domain/rca/validateRca.ts), which is why the parity
// test checks against it specifically.
export const ROOT_CAUSE_CATEGORIES = [
  "CODE_DEFECT",
  "INFRASTRUCTURE_FAILURE",
  "CONFIGURATION_ERROR",
  "CAPACITY_EXHAUSTION",
  "EXTERNAL_DEPENDENCY",
  "NETWORK",
  "HUMAN_ERROR",
  "UNKNOWN",
] as const;
export type RootCauseCategory = (typeof ROOT_CAUSE_CATEGORIES)[number];

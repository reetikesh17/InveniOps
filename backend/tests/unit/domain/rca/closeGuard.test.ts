import { describe, expect, it } from "vitest";
import { createWorkItemStateGraph } from "../../../../src/domain/state/graph.js";
import { InvalidTransitionError } from "../../../../src/domain/state/errors.js";
import type { TransitionContext, WorkItemSnapshot } from "../../../../src/domain/state/types.js";
import { createRcaCloseGuard } from "../../../../src/domain/rca/closeGuard.js";
import type { RcaRecord } from "../../../../src/domain/rca/types.js";

const FIRST_SIGNAL_AT = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-01-02T00:00:00.000Z");
const VALID_TEXT = "Restarted the connection pool after exhausting max connections.";

function validRca(): RcaRecord {
  return {
    incidentStartTime: new Date("2026-01-01T01:00:00.000Z"),
    incidentEndTime: new Date("2026-01-01T02:00:00.000Z"),
    rootCauseCategory: "INFRASTRUCTURE_FAILURE",
    rootCauseDescription: VALID_TEXT,
    fixApplied: VALID_TEXT,
    preventionSteps: VALID_TEXT,
  };
}

function resolvedWorkItem(): WorkItemSnapshot {
  return { id: "wi-1", state: "RESOLVED", firstSignalAt: FIRST_SIGNAL_AT };
}

describe("createRcaCloseGuard", () => {
  it("allows RESOLVED -> CLOSED through the real state graph when the RCA is valid", () => {
    const graph = createWorkItemStateGraph(createRcaCloseGuard(() => NOW));
    const context: TransitionContext = { workItem: resolvedWorkItem(), to: "CLOSED", payload: validRca() };

    expect(graph.RESOLVED.transition(context)).toBe(graph.CLOSED);
  });

  it("blocks RESOLVED -> CLOSED through the real state graph when the RCA is invalid", () => {
    const graph = createWorkItemStateGraph(createRcaCloseGuard(() => NOW));
    const invalidRca: RcaRecord = { ...validRca(), fixApplied: "" };
    const context: TransitionContext = { workItem: resolvedWorkItem(), to: "CLOSED", payload: invalidRca };

    expect(() => graph.RESOLVED.transition(context)).toThrow(InvalidTransitionError);
  });

  it("blocks the transition when there is no RCA payload at all", () => {
    const graph = createWorkItemStateGraph(createRcaCloseGuard(() => NOW));
    const context: TransitionContext = { workItem: resolvedWorkItem(), to: "CLOSED" };

    expect(() => graph.RESOLVED.transition(context)).toThrow(InvalidTransitionError);
  });

  it("returns false when the payload is not an RCA-shaped object", () => {
    const guard = createRcaCloseGuard(() => NOW);

    expect(guard({ workItem: resolvedWorkItem(), to: "CLOSED", payload: "not an object" })).toBe(false);
    expect(guard({ workItem: resolvedWorkItem(), to: "CLOSED", payload: 42 })).toBe(false);
  });

  it("evaluates against the injected clock, not wall-clock time", () => {
    // validRca()'s timestamps are 2026-01-01 — after this fixed "now" of
    // 2020, so they'd fail the "cannot be in the future" check relative to
    // the injected clock specifically.
    const guard = createRcaCloseGuard(() => new Date("2020-01-01T00:00:00.000Z"));

    expect(guard({ workItem: resolvedWorkItem(), to: "CLOSED", payload: validRca() })).toBe(false);
  });
});

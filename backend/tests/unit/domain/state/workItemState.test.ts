import { describe, expect, it } from "vitest";
import {
  createWorkItemStateGraph,
  getLegalNextStates,
  InvalidTransitionError,
  type TransitionContext,
  type WorkItemStateName,
} from "../../../../src/domain/state/index.js";

const ALL_STATES = ["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"] as const;

const LEGAL_PAIRS = new Set(["OPEN->INVESTIGATING", "INVESTIGATING->RESOLVED", "RESOLVED->CLOSED"]);

const ILLEGAL_PAIRS: readonly (readonly [WorkItemStateName, WorkItemStateName])[] = ALL_STATES.flatMap((from) =>
  ALL_STATES.filter((to) => !LEGAL_PAIRS.has(`${from}->${to}`)).map((to) => [from, to] as const),
);

function makeContext(
  currentState: WorkItemStateName,
  to: WorkItemStateName,
  payload?: unknown,
): TransitionContext {
  return {
    workItem: { id: "wi-1", state: currentState, firstSignalAt: new Date("2026-01-01T00:00:00.000Z") },
    to,
    payload,
  };
}

describe("work item state machine", () => {
  describe("legal transitions", () => {
    it("OPEN -> INVESTIGATING succeeds", () => {
      const graph = createWorkItemStateGraph(() => true);
      const next = graph.OPEN.transition(makeContext("OPEN", "INVESTIGATING"));
      expect(next).toBe(graph.INVESTIGATING);
    });

    it("INVESTIGATING -> RESOLVED succeeds", () => {
      const graph = createWorkItemStateGraph(() => true);
      const next = graph.INVESTIGATING.transition(makeContext("INVESTIGATING", "RESOLVED"));
      expect(next).toBe(graph.RESOLVED);
    });

    it("RESOLVED -> CLOSED succeeds when the guard passes", () => {
      const graph = createWorkItemStateGraph(() => true);
      const next = graph.RESOLVED.transition(makeContext("RESOLVED", "CLOSED"));
      expect(next).toBe(graph.CLOSED);
    });

    it("RESOLVED -> CLOSED throws InvalidTransitionError when the guard fails", () => {
      const graph = createWorkItemStateGraph(() => false);
      expect(() => graph.RESOLVED.transition(makeContext("RESOLVED", "CLOSED"))).toThrow(
        InvalidTransitionError,
      );
    });

    it("passes the full context through to the guard", () => {
      let received: TransitionContext | undefined;
      const graph = createWorkItemStateGraph((context) => {
        received = context;
        return true;
      });
      const context = makeContext("RESOLVED", "CLOSED", { hasRca: true });

      graph.RESOLVED.transition(context);

      expect(received).toBe(context);
    });
  });

  describe("illegal transitions", () => {
    it.each(ILLEGAL_PAIRS)("%s -> %s throws InvalidTransitionError", (from, to) => {
      const graph = createWorkItemStateGraph(() => true);
      expect(() => graph[from].transition(makeContext(from, to))).toThrow(InvalidTransitionError);
    });

    it("InvalidTransitionError names both the current and attempted state", () => {
      const graph = createWorkItemStateGraph(() => true);

      expect.assertions(4);
      try {
        graph.OPEN.transition(makeContext("OPEN", "CLOSED"));
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTransitionError);
        expect(error).toBeInstanceOf(Error);
        expect((error as InvalidTransitionError).currentState).toBe("OPEN");
        expect((error as InvalidTransitionError).attemptedState).toBe("CLOSED");
      }
    });
  });

  describe("CLOSED is terminal", () => {
    it.each(ALL_STATES)("CLOSED -> %s always throws", (to) => {
      const graph = createWorkItemStateGraph(() => true);
      expect(() => graph.CLOSED.transition(makeContext("CLOSED", to))).toThrow(InvalidTransitionError);
    });

    it("has no legal next states", () => {
      const graph = createWorkItemStateGraph(() => true);
      expect(graph.CLOSED.getLegalNextStates()).toEqual([]);
    });
  });

  describe("transition() purity", () => {
    it("does not mutate the context or work item passed in", () => {
      const graph = createWorkItemStateGraph(() => true);
      const context = makeContext("OPEN", "INVESTIGATING");
      const snapshot = structuredClone(context);

      graph.OPEN.transition(context);

      expect(context).toEqual(snapshot);
    });

    it("does not persist or otherwise call out anywhere — returns a value only", () => {
      const graph = createWorkItemStateGraph(() => true);
      const result = graph.OPEN.transition(makeContext("OPEN", "INVESTIGATING"));
      expect(result).toBeDefined();
      expect(result.name).toBe("INVESTIGATING");
    });
  });

  describe("getLegalNextStates (standalone pure function)", () => {
    it("OPEN -> [INVESTIGATING]", () => {
      expect(getLegalNextStates("OPEN")).toEqual(["INVESTIGATING"]);
    });

    it("INVESTIGATING -> [RESOLVED]", () => {
      expect(getLegalNextStates("INVESTIGATING")).toEqual(["RESOLVED"]);
    });

    it("RESOLVED -> [CLOSED]", () => {
      expect(getLegalNextStates("RESOLVED")).toEqual(["CLOSED"]);
    });

    it("CLOSED -> []", () => {
      expect(getLegalNextStates("CLOSED")).toEqual([]);
    });
  });

  describe("graph wiring", () => {
    it.each(ALL_STATES)("graph.%s.name matches its key", (name) => {
      const graph = createWorkItemStateGraph(() => true);
      expect(graph[name].name).toBe(name);
    });
  });
});

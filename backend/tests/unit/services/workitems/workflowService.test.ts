import { describe, expect, it } from "vitest";
import { ComponentType, Severity, WorkItemStatus, type WorkItem, type RcaRecord } from "@prisma/client";
import {
  WorkflowService,
  type WorkItemWorkflowStore,
  type WorkflowCache,
} from "../../../../src/services/workitems/workflowService.js";
import type {
  TransitionStateInput,
  SubmitRcaInput,
  SubmitRcaResult,
} from "../../../../src/repositories/postgres/workItemRepository.js";
import type { WorkItemWithRca } from "../../../../src/repositories/postgres/index.js";
import { OptimisticConcurrencyError } from "../../../../src/repositories/postgres/index.js";

const FIRST_SIGNAL_AT = new Date("2026-01-01T00:00:00.000Z");
const VALID_TEXT = "Restarted the connection pool after exhausting max connections.";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    componentId: "CACHE_CLUSTER_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    state: WorkItemStatus.OPEN,
    title: "test incident",
    firstSignalAt: FIRST_SIGNAL_AT,
    resolvedAt: null,
    closedAt: null,
    signalCount: 5,
    createdAt: FIRST_SIGNAL_AT,
    updatedAt: FIRST_SIGNAL_AT,
    ...overrides,
  };
}

function validRcaInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    incidentStartTime: "2026-01-01T01:00:00.000Z",
    incidentEndTime: "2026-01-01T02:00:00.000Z",
    rootCauseCategory: "INFRASTRUCTURE_FAILURE",
    rootCauseDescription: VALID_TEXT,
    fixApplied: VALID_TEXT,
    preventionSteps: VALID_TEXT,
    ...overrides,
  };
}

interface FakeStore extends WorkItemWorkflowStore {
  readonly transitionCalls: TransitionStateInput[];
  readonly submitRcaCalls: SubmitRcaInput[];
}

function fakeWorkItemStore(
  initial: WorkItem | null,
  options: { readonly throwOnTransition?: Error; readonly throwOnSubmitRca?: Error } = {},
): FakeStore {
  let current: WorkItemWithRca | null = initial ? { ...initial, rca: null } : null;
  const transitionCalls: TransitionStateInput[] = [];
  const submitRcaCalls: SubmitRcaInput[] = [];

  return {
    transitionCalls,
    submitRcaCalls,
    findById(id: string): Promise<WorkItemWithRca | null> {
      return Promise.resolve(current && current.id === id ? current : null);
    },
    transitionState(input: TransitionStateInput): Promise<WorkItem> {
      transitionCalls.push(input);
      if (options.throwOnTransition) {
        return Promise.reject(options.throwOnTransition);
      }
      if (!current) {
        return Promise.reject(new Error("fake: no work item"));
      }
      const updated: WorkItem = { ...current, state: input.toState, ...(input.data ?? {}) };
      current = { ...updated, rca: current.rca };
      return Promise.resolve(updated);
    },
    submitRca(input: SubmitRcaInput): Promise<SubmitRcaResult> {
      submitRcaCalls.push(input);
      if (options.throwOnSubmitRca) {
        return Promise.reject(options.throwOnSubmitRca);
      }
      if (!current) {
        return Promise.reject(new Error("fake: no work item"));
      }
      const now = input.now ?? new Date();
      const rca: RcaRecord = {
        id: "rca-1",
        workItemId: input.workItemId,
        incidentStartTime: input.rca.incidentStartTime,
        incidentEndTime: input.rca.incidentEndTime,
        rootCauseCategory: input.rca.rootCauseCategory,
        rootCauseDescription: input.rca.rootCauseDescription,
        fixApplied: input.rca.fixApplied,
        preventionSteps: input.rca.preventionSteps,
        mttrSeconds: input.mttrSeconds,
        submittedAt: now,
      };
      const updatedWorkItem: WorkItem = { ...current, state: WorkItemStatus.CLOSED, closedAt: now };
      current = { ...updatedWorkItem, rca };
      return Promise.resolve({ workItem: updatedWorkItem, rca });
    },
  };
}

function fakeCache(): WorkflowCache & { upsertCalls: WorkItem[]; removeCalls: string[] } {
  const upsertCalls: WorkItem[] = [];
  const removeCalls: string[] = [];
  return {
    upsertCalls,
    removeCalls,
    upsertActiveIncident(workItem: WorkItem): Promise<unknown> {
      upsertCalls.push(workItem);
      return Promise.resolve(null);
    },
    removeIncident(workItemId: string): Promise<unknown> {
      removeCalls.push(workItemId);
      return Promise.resolve(undefined);
    },
  };
}

interface DispatchCall {
  readonly workItem: WorkItem;
  readonly eventType: string;
}

function fakeDispatcher(): { dispatch(workItem: WorkItem, eventType: string): Promise<void>; calls: DispatchCall[] } {
  const calls: DispatchCall[] = [];
  return {
    calls,
    dispatch(workItem: WorkItem, eventType: string): Promise<void> {
      calls.push({ workItem, eventType });
      return Promise.resolve();
    },
  };
}

describe("WorkflowService.transitionWorkItem", () => {
  it("transitions OPEN -> INVESTIGATING and writes through to the cache", async () => {
    const store = fakeWorkItemStore(makeWorkItem({ state: WorkItemStatus.OPEN }));
    const cache = fakeCache();
    const dispatcher = fakeDispatcher();
    const service = new WorkflowService(store, cache, dispatcher);

    const result = await service.transitionWorkItem("wi-1", "INVESTIGATING", "alice");

    expect(result).toMatchObject({ outcome: "transitioned" });
    expect(store.transitionCalls).toEqual([
      { workItemId: "wi-1", fromState: "OPEN", toState: "INVESTIGATING", actor: "alice" },
    ]);
    expect(cache.upsertCalls).toHaveLength(1);
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0]?.workItem.id).toBe("wi-1");
    expect(dispatcher.calls[0]?.eventType).toBe("INVESTIGATING");
  });

  it("rejects an illegal transition (OPEN -> RESOLVED, skipping INVESTIGATING) without touching persistence", async () => {
    const store = fakeWorkItemStore(makeWorkItem({ state: WorkItemStatus.OPEN }));
    const cache = fakeCache();
    const dispatcher = fakeDispatcher();
    const service = new WorkflowService(store, cache, dispatcher);

    const result = await service.transitionWorkItem("wi-1", "RESOLVED", "alice");

    expect(result.outcome).toBe("invalid_transition");
    expect(store.transitionCalls).toHaveLength(0);
    expect(cache.upsertCalls).toHaveLength(0);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it("rejects CLOSED unconditionally — no RCA payload is ever supplied through this method, regardless of current state", async () => {
    for (const state of [WorkItemStatus.OPEN, WorkItemStatus.INVESTIGATING, WorkItemStatus.RESOLVED] as const) {
      const store = fakeWorkItemStore(makeWorkItem({ state }));
      const service = new WorkflowService(store, fakeCache(), fakeDispatcher());

      const result = await service.transitionWorkItem("wi-1", "CLOSED", "alice");

      expect(result.outcome).toBe("invalid_transition");
      expect(store.transitionCalls).toHaveLength(0);
    }
  });

  it("returns not_found for a nonexistent work item", async () => {
    const service = new WorkflowService(fakeWorkItemStore(null), fakeCache(), fakeDispatcher());
    const result = await service.transitionWorkItem("missing", "INVESTIGATING", "alice");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a repository-level concurrency conflict to the conflict outcome", async () => {
    const store = fakeWorkItemStore(makeWorkItem({ state: WorkItemStatus.OPEN }), {
      throwOnTransition: new OptimisticConcurrencyError("wi-1", "OPEN"),
    });
    const service = new WorkflowService(store, fakeCache(), fakeDispatcher());

    const result = await service.transitionWorkItem("wi-1", "INVESTIGATING", "alice");

    expect(result.outcome).toBe("conflict");
  });
});

describe("WorkflowService.submitIncidentRca", () => {
  it("rejects RCA submission when the work item was never RESOLVED — even with a fully valid RCA payload", async () => {
    for (const state of [WorkItemStatus.OPEN, WorkItemStatus.INVESTIGATING] as const) {
      const store = fakeWorkItemStore(makeWorkItem({ state }));
      const service = new WorkflowService(store, fakeCache(), fakeDispatcher());

      const result = await service.submitIncidentRca("wi-1", validRcaInput(), "alice");

      expect(result.outcome).toBe("invalid_state");
      expect(store.submitRcaCalls).toHaveLength(0);
    }
  });

  it("rejects an incomplete RCA for a RESOLVED work item with field-level errors", async () => {
    const store = fakeWorkItemStore(makeWorkItem({ state: WorkItemStatus.RESOLVED }));
    const service = new WorkflowService(store, fakeCache(), fakeDispatcher());

    const result = await service.submitIncidentRca(
      "wi-1",
      validRcaInput({ fixApplied: "", preventionSteps: undefined }),
      "alice",
    );

    expect(result.outcome).toBe("invalid_rca");
    if (result.outcome === "invalid_rca") {
      const fields = result.errors.map((error) => error.field);
      expect(fields).toContain("fixApplied");
      expect(fields).toContain("preventionSteps");
    }
    expect(store.submitRcaCalls).toHaveLength(0);
  });

  it("closes a RESOLVED work item given a valid RCA, computing MTTR from firstSignalAt to submission time, and evicts it from the active cache", async () => {
    const store = fakeWorkItemStore(makeWorkItem({ state: WorkItemStatus.RESOLVED, firstSignalAt: FIRST_SIGNAL_AT }));
    const cache = fakeCache();
    const dispatcher = fakeDispatcher();
    const service = new WorkflowService(store, cache, dispatcher);
    const submittedAt = new Date("2026-01-01T02:30:00.000Z"); // 2.5h after firstSignalAt

    const result = await service.submitIncidentRca("wi-1", validRcaInput(), "alice", submittedAt);

    expect(result.outcome).toBe("closed");
    if (result.outcome === "closed") {
      expect(result.mttrSeconds).toBe(2.5 * 3600);
      expect(result.workItem.state).toBe(WorkItemStatus.CLOSED);
    }
    expect(store.submitRcaCalls).toHaveLength(1);
    expect(cache.removeCalls).toEqual(["wi-1"]);
    expect(cache.upsertCalls).toHaveLength(0);
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0]?.workItem.id).toBe("wi-1");
    expect(dispatcher.calls[0]?.eventType).toBe("CLOSED");
  });

  it("returns not_found for a nonexistent work item", async () => {
    const service = new WorkflowService(fakeWorkItemStore(null), fakeCache(), fakeDispatcher());
    const result = await service.submitIncidentRca("missing", validRcaInput(), "alice");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a repository-level concurrency conflict during submitRca to the invalid_state outcome", async () => {
    const store = fakeWorkItemStore(makeWorkItem({ state: WorkItemStatus.RESOLVED }), {
      throwOnSubmitRca: new OptimisticConcurrencyError("wi-1", "RESOLVED"),
    });
    const service = new WorkflowService(store, fakeCache(), fakeDispatcher());

    const result = await service.submitIncidentRca("wi-1", validRcaInput(), "alice");

    expect(result.outcome).toBe("invalid_state");
  });
});

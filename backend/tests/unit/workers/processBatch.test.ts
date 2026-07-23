import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ComponentType, Severity, WorkItemStatus, type WorkItem } from "@prisma/client";
import {
  processBatch,
  type BatchDebouncer,
  type BatchSignalStore,
  type BatchWorkItemStore,
  type BatchCache,
} from "../../../src/workers/processBatch.js";
import type { DebounceResult } from "../../../src/services/ingestion/debouncer.js";
import type { IngestionSignal } from "../../../src/services/ingestion/buffer.js";
import type { SignalDocument, InsertManyIdempotentResult } from "../../../src/repositories/mongo/signalRepository.js";

function makeSignal(componentId: string, overrides: Partial<IngestionSignal> = {}): IngestionSignal {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    signalId: randomUUID(),
    componentId,
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    rawPayload: {},
    occurredAt: now,
    receivedAt: now,
    ...overrides,
  };
}

function makeWorkItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    componentId: "unused",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    state: WorkItemStatus.OPEN,
    title: "test work item",
    firstSignalAt: new Date("2026-01-01T00:00:00.000Z"),
    resolvedAt: null,
    closedAt: null,
    signalCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Resolves every signal for a componentId to the same fixed workItemId — set up per test via `assign`. */
function fakeDebouncer(componentToWorkItemId: ReadonlyMap<string, string>): BatchDebouncer {
  return {
    resolveBatch(signals: readonly IngestionSignal[]): Promise<readonly DebounceResult[]> {
      return Promise.resolve(
        signals.map((signal) => {
          const workItemId = componentToWorkItemId.get(signal.componentId);
          if (!workItemId) {
            throw new Error(`no fake resolution configured for componentId ${signal.componentId}`);
          }
          return { workItemId, created: false };
        }),
      );
    },
  };
}

/** In-memory idempotent store: signalIds in `alreadyPersisted` are treated as already durably written. */
function fakeSignalStore(alreadyPersisted: ReadonlySet<string> = new Set()): BatchSignalStore & { readonly inserted: SignalDocument[] } {
  const inserted: SignalDocument[] = [];
  return {
    inserted,
    insertManyIdempotent(signals: readonly SignalDocument[]): Promise<InsertManyIdempotentResult> {
      const newDocs = signals.filter((signal) => !alreadyPersisted.has(signal.signalId));
      inserted.push(...newDocs);
      return Promise.resolve({ insertedSignalIds: newDocs.map((signal) => signal.signalId) });
    },
  };
}

function fakeWorkItemStore(): BatchWorkItemStore & { readonly incrementCalls: Array<{ workItemId: string; by: number }> } {
  const incrementCalls: Array<{ workItemId: string; by: number }> = [];
  return {
    incrementCalls,
    incrementSignalCount(workItemId: string, by: number): Promise<WorkItem> {
      incrementCalls.push({ workItemId, by });
      return Promise.resolve(makeWorkItem(workItemId, { signalCount: by }));
    },
  };
}

function fakeCache(): BatchCache & { readonly upserted: WorkItem[] } {
  const upserted: WorkItem[] = [];
  return {
    upserted,
    upsertActiveIncident(workItem: WorkItem): Promise<void> {
      upserted.push(workItem);
      return Promise.resolve();
    },
  };
}

describe("processBatch", () => {
  it("is a no-op for an empty batch", async () => {
    const workItemStore = fakeWorkItemStore();
    const cache = fakeCache();
    const result = await processBatch([], {
      debouncer: fakeDebouncer(new Map()),
      signalStore: fakeSignalStore(),
      workItemStore,
      cache,
    });

    expect(result).toEqual({ totalSignals: 0, newlyPersisted: 0, workItemsTouched: 0 });
    expect(workItemStore.incrementCalls).toHaveLength(0);
    expect(cache.upserted).toHaveLength(0);
  });

  it("persists every signal and increments each work item once per newly-inserted signal", async () => {
    const signalA1 = makeSignal("COMPONENT_A");
    const signalA2 = makeSignal("COMPONENT_A");
    const signalB1 = makeSignal("COMPONENT_B");

    const signalStore = fakeSignalStore();
    const workItemStore = fakeWorkItemStore();
    const cache = fakeCache();

    const result = await processBatch([signalA1, signalA2, signalB1], {
      debouncer: fakeDebouncer(
        new Map([
          ["COMPONENT_A", "work-item-a"],
          ["COMPONENT_B", "work-item-b"],
        ]),
      ),
      signalStore,
      workItemStore,
      cache,
    });

    expect(result).toEqual({ totalSignals: 3, newlyPersisted: 3, workItemsTouched: 2 });
    expect(signalStore.inserted.map((doc) => doc.signalId).sort()).toEqual(
      [signalA1.signalId, signalA2.signalId, signalB1.signalId].sort(),
    );

    // Grouped: one increment call per work item, not per signal.
    expect(workItemStore.incrementCalls).toHaveLength(2);
    expect(workItemStore.incrementCalls).toContainEqual({ workItemId: "work-item-a", by: 2 });
    expect(workItemStore.incrementCalls).toContainEqual({ workItemId: "work-item-b", by: 1 });

    expect(cache.upserted.map((workItem) => workItem.id).sort()).toEqual(["work-item-a", "work-item-b"]);
  });

  it("excludes already-persisted signals from the increment count — idempotent under retry", async () => {
    const alreadyPersisted = makeSignal("COMPONENT_A");
    const newSignal = makeSignal("COMPONENT_A");

    const signalStore = fakeSignalStore(new Set([alreadyPersisted.signalId]));
    const workItemStore = fakeWorkItemStore();
    const cache = fakeCache();

    const result = await processBatch([alreadyPersisted, newSignal], {
      debouncer: fakeDebouncer(new Map([["COMPONENT_A", "work-item-a"]])),
      signalStore,
      workItemStore,
      cache,
    });

    expect(result).toEqual({ totalSignals: 2, newlyPersisted: 1, workItemsTouched: 1 });
    // Only the genuinely new signal counts — a naive retry that recounted
    // the already-persisted one would report `by: 2` here.
    expect(workItemStore.incrementCalls).toEqual([{ workItemId: "work-item-a", by: 1 }]);
  });

  it("touches nothing for a work item whose signals were all already persisted", async () => {
    const alreadyPersisted1 = makeSignal("COMPONENT_A");
    const alreadyPersisted2 = makeSignal("COMPONENT_A");

    const signalStore = fakeSignalStore(new Set([alreadyPersisted1.signalId, alreadyPersisted2.signalId]));
    const workItemStore = fakeWorkItemStore();
    const cache = fakeCache();

    const result = await processBatch([alreadyPersisted1, alreadyPersisted2], {
      debouncer: fakeDebouncer(new Map([["COMPONENT_A", "work-item-a"]])),
      signalStore,
      workItemStore,
      cache,
    });

    expect(result).toEqual({ totalSignals: 2, newlyPersisted: 0, workItemsTouched: 0 });
    expect(workItemStore.incrementCalls).toHaveLength(0);
    expect(cache.upserted).toHaveLength(0);
  });
});

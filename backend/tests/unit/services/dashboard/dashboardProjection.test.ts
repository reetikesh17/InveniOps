import { describe, expect, it } from "vitest";
import { ComponentType, Severity, WorkItemStatus, type WorkItem } from "@prisma/client";
import {
  DashboardProjectionService,
  type WorkItemReadStore,
  type SignalReadStore,
  type DashboardCache,
  type Pagination,
} from "../../../../src/services/dashboard/dashboardProjection.js";
import type { IncidentSummary, ActiveIncidentPage } from "../../../../src/repositories/redis/dashboardCache.js";
import type { SignalDocument } from "../../../../src/repositories/mongo/signalRepository.js";
import type { WorkItemWithRca } from "../../../../src/repositories/postgres/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    componentId: "CACHE_CLUSTER_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    state: WorkItemStatus.OPEN,
    title: "test incident",
    firstSignalAt: NOW,
    resolvedAt: null,
    closedAt: null,
    signalCount: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function toSummary(workItem: WorkItem): IncidentSummary {
  return {
    id: workItem.id,
    componentId: workItem.componentId,
    componentType: workItem.componentType,
    severity: workItem.severity,
    state: workItem.state,
    title: workItem.title,
    firstSignalAt: workItem.firstSignalAt.toISOString(),
    signalCount: workItem.signalCount,
    updatedAt: workItem.updatedAt.toISOString(),
  };
}

function fakeWorkItemStore(workItems: readonly WorkItemWithRca[]): WorkItemReadStore & { findByIdCalls: string[] } {
  const findByIdCalls: string[] = [];
  return {
    findByIdCalls,
    findById(id: string): Promise<WorkItemWithRca | null> {
      findByIdCalls.push(id);
      return Promise.resolve(workItems.find((workItem) => workItem.id === id) ?? null);
    },
    listActive(pagination: Pagination): Promise<WorkItem[]> {
      const active = workItems.filter((workItem) => workItem.state !== "CLOSED");
      return Promise.resolve(active.slice(pagination.offset, pagination.offset + pagination.limit));
    },
  };
}

function fakeSignalStore(documents: readonly SignalDocument[]): SignalReadStore {
  return {
    findByWorkItemId(workItemId: string, pagination: Pagination): Promise<SignalDocument[]> {
      const matching = documents.filter((doc) => doc.workItemId === workItemId);
      return Promise.resolve(matching.slice(pagination.offset, pagination.offset + pagination.limit));
    },
    countByWorkItemId(workItemId: string): Promise<number> {
      return Promise.resolve(documents.filter((doc) => doc.workItemId === workItemId).length);
    },
  };
}

/** In-memory stand-in for Redis: a real cache-hit/miss/repopulate cycle, no network. */
function fakeCache(): DashboardCache & { readonly upsertCalls: WorkItem[] } {
  const summaries = new Map<string, IncidentSummary>();
  const order: string[] = [];
  const upsertCalls: WorkItem[] = [];

  return {
    upsertCalls,
    upsertActiveIncident(workItem: WorkItem): Promise<IncidentSummary | null> {
      upsertCalls.push(workItem);
      if (workItem.state === "CLOSED") {
        summaries.delete(workItem.id);
        const index = order.indexOf(workItem.id);
        if (index !== -1) {
          order.splice(index, 1);
        }
        return Promise.resolve(null);
      }
      const summary = toSummary(workItem);
      if (!summaries.has(workItem.id)) {
        order.push(workItem.id);
      }
      summaries.set(workItem.id, summary);
      return Promise.resolve(summary);
    },
    getIncidentSummary(workItemId: string): Promise<IncidentSummary | null> {
      return Promise.resolve(summaries.get(workItemId) ?? null);
    },
    getActiveIncidentIds(pagination: Pagination): Promise<ActiveIncidentPage> {
      const ids = order.slice(pagination.offset, pagination.offset + pagination.limit);
      return Promise.resolve({ ids, total: order.length });
    },
  };
}

describe("DashboardProjectionService.getActiveIncidents", () => {
  it("serves from a warm cache without touching Postgres", async () => {
    const workItem = makeWorkItem();
    const cache = fakeCache();
    await cache.upsertActiveIncident(workItem);

    const workItemStore = fakeWorkItemStore([{ ...workItem, rca: null }]);
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore([]), cache, { repopulateCap: 100 });

    const page = await service.getActiveIncidents({ limit: 10, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.items).toEqual([toSummary(workItem)]);
    expect(workItemStore.findByIdCalls).toHaveLength(0);
  });

  it("repopulates from Postgres on a cold cache and serves the correct page afterward", async () => {
    const workItems = [
      makeWorkItem({ id: "wi-1", severity: Severity.P0 }),
      makeWorkItem({ id: "wi-2", severity: Severity.P1 }),
    ];
    const workItemStore = fakeWorkItemStore(workItems.map((workItem) => ({ ...workItem, rca: null })));
    const cache = fakeCache(); // starts empty — simulates a cold/flushed cache
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore([]), cache, { repopulateCap: 100 });

    const page = await service.getActiveIncidents({ limit: 10, offset: 0 });

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id).sort()).toEqual(["wi-1", "wi-2"]);
    expect(cache.upsertCalls.length).toBeGreaterThan(0); // repopulation actually wrote through
  });

  it("does not repopulate when the cache is warm but the page is simply past the end", async () => {
    const workItem = makeWorkItem();
    const cache = fakeCache();
    await cache.upsertActiveIncident(workItem);

    const workItemStore = fakeWorkItemStore([{ ...workItem, rca: null }]);
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore([]), cache, { repopulateCap: 100 });

    const page = await service.getActiveIncidents({ limit: 10, offset: 50 });

    expect(page.total).toBe(1); // real total, not zero — this is not a cache miss
    expect(page.items).toHaveLength(0);
    expect(workItemStore.findByIdCalls).toHaveLength(0); // never fell back to Postgres
  });
});

describe("DashboardProjectionService.getIncidentDetail", () => {
  it("serves an active incident from cache with legalNextStates derived, and no RCA", async () => {
    const workItem = makeWorkItem({ state: WorkItemStatus.OPEN });
    const cache = fakeCache();
    await cache.upsertActiveIncident(workItem);
    const workItemStore = fakeWorkItemStore([{ ...workItem, rca: null }]);
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore([]), cache, { repopulateCap: 100 });

    const detail = await service.getIncidentDetail("wi-1");

    expect(detail).not.toBeNull();
    expect(detail?.legalNextStates).toEqual(["INVESTIGATING"]);
    expect(detail?.rca).toBeNull();
    expect(workItemStore.findByIdCalls).toHaveLength(0);
  });

  it("falls back to Postgres and repopulates on a cold cache for an active incident", async () => {
    const workItem = makeWorkItem({ state: WorkItemStatus.INVESTIGATING });
    const workItemStore = fakeWorkItemStore([{ ...workItem, rca: null }]);
    const cache = fakeCache();
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore([]), cache, { repopulateCap: 100 });

    const detail = await service.getIncidentDetail("wi-1");

    expect(detail?.legalNextStates).toEqual(["RESOLVED"]);
    expect(cache.upsertCalls).toHaveLength(1); // cold-cache recovery wrote it through
  });

  it("serves a CLOSED incident directly from Postgres, including its RCA, without touching the active cache", async () => {
    const rca = {
      id: "rca-1",
      workItemId: "wi-1",
      incidentStartTime: NOW,
      incidentEndTime: NOW,
      rootCauseCategory: "INFRASTRUCTURE_FAILURE",
      rootCauseDescription: "desc",
      fixApplied: "fix",
      preventionSteps: "steps",
      mttrSeconds: 3600,
      submittedAt: NOW,
    };
    const workItem = makeWorkItem({ state: WorkItemStatus.CLOSED, closedAt: NOW });
    const workItemStore = fakeWorkItemStore([{ ...workItem, rca }]);
    const cache = fakeCache();
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore([]), cache, { repopulateCap: 100 });

    const detail = await service.getIncidentDetail("wi-1");

    expect(detail?.state).toBe("CLOSED");
    expect(detail?.legalNextStates).toEqual([]);
    expect(detail?.rca).toMatchObject({ mttrSeconds: 3600, rootCauseCategory: "INFRASTRUCTURE_FAILURE" });
    expect(cache.upsertCalls).toHaveLength(0); // CLOSED never gets written into the active cache
  });

  it("returns null for a nonexistent incident", async () => {
    const service = new DashboardProjectionService(fakeWorkItemStore([]), fakeSignalStore([]), fakeCache(), {
      repopulateCap: 100,
    });
    expect(await service.getIncidentDetail("missing")).toBeNull();
  });
});

describe("DashboardProjectionService.getIncidentSignals", () => {
  it("returns paginated signals for an existing incident", async () => {
    const workItem = makeWorkItem();
    const workItemStore = fakeWorkItemStore([{ ...workItem, rca: null }]);
    const documents: SignalDocument[] = [0, 1, 2].map((i) => ({
      signalId: `sig-${i}`,
      componentId: workItem.componentId,
      componentType: workItem.componentType,
      severity: workItem.severity,
      rawPayload: {},
      occurredAt: NOW,
      receivedAt: NOW,
      workItemId: workItem.id,
    }));
    const service = new DashboardProjectionService(workItemStore, fakeSignalStore(documents), fakeCache(), {
      repopulateCap: 100,
    });

    const page = await service.getIncidentSignals("wi-1", { limit: 2, offset: 0 });

    expect(page?.total).toBe(3);
    expect(page?.items).toHaveLength(2);
  });

  it("returns null for a nonexistent incident rather than an empty page", async () => {
    const service = new DashboardProjectionService(fakeWorkItemStore([]), fakeSignalStore([]), fakeCache(), {
      repopulateCap: 100,
    });
    expect(await service.getIncidentSignals("missing", { limit: 10, offset: 0 })).toBeNull();
  });
});

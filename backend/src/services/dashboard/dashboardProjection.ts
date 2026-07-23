import type { WorkItem, RcaRecord as PrismaRcaRecord } from "@prisma/client";
import { getLegalNextStates, type WorkItemStateName } from "../../domain/state/index.js";
import type { IncidentSummary, ActiveIncidentPage } from "../../repositories/redis/dashboardCache.js";
import type { SignalDocument } from "../../repositories/mongo/signalRepository.js";
import type { WorkItemWithRca } from "../../repositories/postgres/index.js";

// Narrow, structural interfaces — the real PostgresWorkItemRepository /
// MongoSignalRepository / DashboardCacheRepository all satisfy these
// without an adapter, but tests can substitute fakes for all three. Same
// pattern as src/services/ingestion/debouncer.ts and
// src/workers/processBatch.ts.
export interface WorkItemReadStore {
  findById(id: string): Promise<WorkItemWithRca | null>;
  listActive(pagination: Pagination): Promise<WorkItem[]>;
}

export interface SignalReadStore {
  findByWorkItemId(workItemId: string, pagination: Pagination): Promise<SignalDocument[]>;
  countByWorkItemId(workItemId: string): Promise<number>;
}

export interface DashboardCache {
  getActiveIncidentIds(pagination: Pagination): Promise<ActiveIncidentPage>;
  getIncidentSummary(workItemId: string): Promise<IncidentSummary | null>;
  upsertActiveIncident(workItem: WorkItem): Promise<IncidentSummary | null>;
}

export interface Pagination {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
}

export interface RcaSummaryDto {
  readonly incidentStartTime: string;
  readonly incidentEndTime: string;
  readonly rootCauseCategory: string;
  readonly rootCauseDescription: string;
  readonly fixApplied: string;
  readonly preventionSteps: string;
  readonly mttrSeconds: number;
  readonly submittedAt: string;
}

export interface IncidentDetailDto extends IncidentSummary {
  readonly legalNextStates: readonly WorkItemStateName[];
  readonly rca: RcaSummaryDto | null;
}

export interface SignalDto {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: string;
  readonly severity: string;
  readonly rawPayload: unknown;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly workItemId: string | null;
}

export interface DashboardProjectionOptions {
  /** Cap on how many active work items a single cold-cache repopulation fetches from Postgres — see docs/data-model.md. */
  readonly repopulateCap: number;
}

/** Exported for the route layer (src/api/routes/workitems.ts) to map a workflow outcome's raw WorkItem into the same DTO shape, rather than leaking the Prisma model. */
export function toIncidentSummary(workItem: WorkItem): IncidentSummary {
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

function toRcaSummaryDto(rca: PrismaRcaRecord): RcaSummaryDto {
  return {
    incidentStartTime: rca.incidentStartTime.toISOString(),
    incidentEndTime: rca.incidentEndTime.toISOString(),
    rootCauseCategory: rca.rootCauseCategory,
    rootCauseDescription: rca.rootCauseDescription,
    fixApplied: rca.fixApplied,
    preventionSteps: rca.preventionSteps,
    mttrSeconds: rca.mttrSeconds,
    submittedAt: rca.submittedAt.toISOString(),
  };
}

function toSignalDto(document: SignalDocument): SignalDto {
  return {
    signalId: document.signalId,
    componentId: document.componentId,
    componentType: document.componentType,
    severity: document.severity,
    rawPayload: document.rawPayload,
    occurredAt: document.occurredAt.toISOString(),
    receivedAt: document.receivedAt.toISOString(),
    workItemId: document.workItemId,
  };
}

/**
 * The dashboard read path: cache-first, Postgres/Mongo on a miss,
 * repopulating synchronously so a cold cache degrades to one extra read,
 * never an error surfaced to the UI. Full design in docs/data-model.md.
 */
export class DashboardProjectionService {
  constructor(
    private readonly workItemStore: WorkItemReadStore,
    private readonly signalStore: SignalReadStore,
    private readonly cache: DashboardCache,
    private readonly options: DashboardProjectionOptions,
  ) {}

  async getActiveIncidents(pagination: Pagination): Promise<Page<IncidentSummary>> {
    let page = await this.cache.getActiveIncidentIds(pagination);

    if (page.total === 0) {
      // Ambiguous by cardinality alone: genuinely zero active incidents,
      // or a cache that was never populated / was flushed. Either way,
      // repopulating from Postgres and re-checking is cheap and correct —
      // a truly-empty system just repopulates nothing and total stays 0.
      await this.repopulateActiveCache();
      page = await this.cache.getActiveIncidentIds(pagination);
    }

    const summaries = await Promise.all(page.ids.map((id) => this.getIncidentSummaryCacheAware(id)));
    const items = summaries.filter((summary): summary is IncidentSummary => summary !== null);

    return { items, total: page.total };
  }

  async getIncidentDetail(workItemId: string): Promise<IncidentDetailDto | null> {
    const cached = await this.cache.getIncidentSummary(workItemId);
    if (cached) {
      return {
        ...cached,
        legalNextStates: getLegalNextStates(cached.state as WorkItemStateName),
        // Cached entries are always active (non-CLOSED) — see
        // DashboardCacheRepository.upsertActiveIncident — and a work item
        // can't have an RCA before it's CLOSED, so this is always
        // correctly null for anything served from cache.
        rca: null,
      };
    }

    // Cache miss: a cold cache for an active item, or — very commonly — a
    // CLOSED item, which is intentionally excluded from the active cache
    // (see docs/data-model.md). Either way, Postgres is the fallback, and
    // findById's join gives us the RCA for free if there is one.
    const workItem = await this.workItemStore.findById(workItemId);
    if (!workItem) {
      return null;
    }

    if (workItem.state !== "CLOSED") {
      await this.cache.upsertActiveIncident(workItem);
    }

    return {
      ...toIncidentSummary(workItem),
      legalNextStates: getLegalNextStates(workItem.state as WorkItemStateName),
      rca: workItem.rca ? toRcaSummaryDto(workItem.rca) : null,
    };
  }

  /** Null means the work item itself doesn't exist — distinct from "exists but has no signals yet." */
  async getIncidentSignals(workItemId: string, pagination: Pagination): Promise<Page<SignalDto> | null> {
    const exists = await this.incidentExists(workItemId);
    if (!exists) {
      return null;
    }

    const [documents, total] = await Promise.all([
      this.signalStore.findByWorkItemId(workItemId, pagination),
      this.signalStore.countByWorkItemId(workItemId),
    ]);

    return { items: documents.map(toSignalDto), total };
  }

  private async incidentExists(workItemId: string): Promise<boolean> {
    const cached = await this.cache.getIncidentSummary(workItemId);
    if (cached) {
      return true;
    }
    const workItem = await this.workItemStore.findById(workItemId);
    return workItem !== null;
  }

  private async getIncidentSummaryCacheAware(workItemId: string): Promise<IncidentSummary | null> {
    const cached = await this.cache.getIncidentSummary(workItemId);
    if (cached) {
      return cached;
    }

    const workItem = await this.workItemStore.findById(workItemId);
    if (!workItem || workItem.state === "CLOSED") {
      return null;
    }
    return this.cache.upsertActiveIncident(workItem);
  }

  private async repopulateActiveCache(): Promise<void> {
    const active = await this.workItemStore.listActive({ limit: this.options.repopulateCap, offset: 0 });
    await Promise.all(active.map((workItem) => this.cache.upsertActiveIncident(workItem)));
  }
}

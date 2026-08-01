import type { WorkItem, RcaRecord as PrismaRcaRecord, StateTransition } from "@prisma/client";
import { getLegalNextStates, type WorkItemStateName } from "../../domain/state/index.js";
import {
  CacheUnavailableError,
  type IncidentSummary,
  type ActiveIncidentPage,
} from "../../repositories/redis/dashboardCache.js";
import type {
  SignalDocument,
  SignalPagination,
} from "../../repositories/mongo/signalRepository.js";
import type { WorkItemWithRca } from "../../repositories/postgres/index.js";

// Narrow, structural interfaces — the real PostgresWorkItemRepository /
// MongoSignalRepository / DashboardCacheRepository all satisfy these
// without an adapter, but tests can substitute fakes for all three. Same
// pattern as src/services/ingestion/debouncer.ts and
// src/workers/processBatch.ts.
export interface WorkItemReadStore {
  findById(id: string): Promise<WorkItemWithRca | null>;
  listActive(pagination: Pagination): Promise<WorkItem[]>;
  /** Total active count, independent of any one page — the Postgres-direct fallback path needs this when the cache itself (not just a key) is unavailable; see getActiveIncidents. */
  countActive(): Promise<number>;
  listClosed(pagination: Pagination): Promise<WorkItem[]>;
  countClosed(): Promise<number>;
  listTransitions(workItemId: string): Promise<StateTransition[]>;
}

export interface SignalReadStore {
  findByWorkItemId(workItemId: string, pagination: SignalPagination): Promise<SignalDocument[]>;
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

// Mirrors the Prisma StateTransition model — see GET /api/v1/incidents/:id/transitions.
export interface StateTransitionDto {
  readonly id: string;
  readonly workItemId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly actor: string;
  readonly occurredAt: string;
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

function toStateTransitionDto(transition: StateTransition): StateTransitionDto {
  return {
    id: transition.id,
    workItemId: transition.workItemId,
    fromState: transition.fromState,
    toState: transition.toState,
    actor: transition.actor,
    occurredAt: transition.occurredAt.toISOString(),
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
    let page: ActiveIncidentPage;
    try {
      page = await this.cache.getActiveIncidentIds(pagination);
    } catch (error) {
      if (error instanceof CacheUnavailableError) {
        // Redis itself is unreachable, not just a cold/empty cache — the
        // repopulate-then-reread cycle below would only fail again and
        // report zero active incidents, which would be wrong, not
        // degraded. Read Postgres directly instead; this bypasses the
        // cache for this call entirely rather than pretending it's warm.
        return this.getActiveIncidentsFromPostgres(pagination);
      }
      throw error;
    }

    if (page.total === 0) {
      // Ambiguous by cardinality alone: genuinely zero active incidents,
      // or a cache that was never populated / was flushed. Either way,
      // repopulating from Postgres and re-checking is cheap and correct —
      // a truly-empty system just repopulates nothing and total stays 0.
      await this.repopulateActiveCache();
      try {
        page = await this.cache.getActiveIncidentIds(pagination);
      } catch (error) {
        if (error instanceof CacheUnavailableError) {
          return this.getActiveIncidentsFromPostgres(pagination);
        }
        throw error;
      }
    }

    const summaries = await Promise.all(
      page.ids.map((id) => this.getIncidentSummaryCacheAware(id)),
    );
    const items = summaries.filter((summary): summary is IncidentSummary => summary !== null);

    return { items, total: page.total };
  }

  /** The degraded path getActiveIncidents falls back to when the cache is genuinely unreachable — same data, same severity-then-firstSignalAt order (listActive's own ORDER BY), just without the cache's ZSET in between. */
  private async getActiveIncidentsFromPostgres(
    pagination: Pagination,
  ): Promise<Page<IncidentSummary>> {
    const [workItems, total] = await Promise.all([
      this.workItemStore.listActive(pagination),
      this.workItemStore.countActive(),
    ]);
    return { items: workItems.map(toIncidentSummary), total };
  }

  /**
   * The closed-incident history list — straight from Postgres (closed items
   * aren't cached), most-recently-closed first, server-paginated because
   * history grows without bound. `updatedAt` on each summary reflects the
   * close time, since closing is the last write to the row.
   */
  async getClosedIncidents(pagination: Pagination): Promise<Page<IncidentSummary>> {
    const [workItems, total] = await Promise.all([
      this.workItemStore.listClosed(pagination),
      this.workItemStore.countClosed(),
    ]);
    return { items: workItems.map(toIncidentSummary), total };
  }

  async getIncidentDetail(workItemId: string): Promise<IncidentDetailDto | null> {
    const cached = await this.getCachedSummaryOrNull(workItemId);
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
  async getIncidentSignals(
    workItemId: string,
    pagination: SignalPagination,
  ): Promise<Page<SignalDto> | null> {
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

  /** Null means the work item itself doesn't exist. Unpaginated: an incident accumulates at most a handful of transitions (one per lifecycle step, plus rare escalation rows) — nowhere near the volume that justifies paging, unlike the raw signal log. */
  async getIncidentTransitions(workItemId: string): Promise<readonly StateTransitionDto[] | null> {
    const exists = await this.incidentExists(workItemId);
    if (!exists) {
      return null;
    }

    const transitions = await this.workItemStore.listTransitions(workItemId);
    return transitions.map(toStateTransitionDto);
  }

  private async incidentExists(workItemId: string): Promise<boolean> {
    const cached = await this.getCachedSummaryOrNull(workItemId);
    if (cached) {
      return true;
    }
    const workItem = await this.workItemStore.findById(workItemId);
    return workItem !== null;
  }

  private async getIncidentSummaryCacheAware(workItemId: string): Promise<IncidentSummary | null> {
    const cached = await this.getCachedSummaryOrNull(workItemId);
    if (cached) {
      return cached;
    }

    const workItem = await this.workItemStore.findById(workItemId);
    if (!workItem || workItem.state === "CLOSED") {
      return null;
    }
    return this.cache.upsertActiveIncident(workItem);
  }

  /** getIncidentSummary(), with a genuinely-unreachable cache folded into the same "treat as miss, fall through to Postgres" shape every caller above already handles — see CacheUnavailableError's own doc comment for why that's safe here specifically (unlike getActiveIncidents' total-count path, a single-id miss has no ambiguous "zero" to misreport). */
  private async getCachedSummaryOrNull(workItemId: string): Promise<IncidentSummary | null> {
    try {
      return await this.cache.getIncidentSummary(workItemId);
    } catch (error) {
      if (error instanceof CacheUnavailableError) {
        return null;
      }
      throw error;
    }
  }

  private async repopulateActiveCache(): Promise<void> {
    const active = await this.workItemStore.listActive({
      limit: this.options.repopulateCap,
      offset: 0,
    });
    await Promise.all(active.map((workItem) => this.cache.upsertActiveIncident(workItem)));
  }
}

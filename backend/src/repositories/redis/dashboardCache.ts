import type { Redis } from "ioredis";
import type { WorkItem } from "@prisma/client";

// Key layout documented in full in docs/data-model.md — a sorted set of
// active incidents (for the dashboard's Live Feed) plus a per-incident
// summary entry (for Incident Detail), both write-through from every
// mutation path (src/workers/processBatch.ts,
// src/services/workitems/workflowService.ts). Reads that miss are
// repopulated from Postgres by src/services/dashboard/dashboardProjection.ts,
// never surfaced as an error.
const ACTIVE_INCIDENTS_KEY = "dashboard:active_incidents";

const SEVERITY_RANK: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function incidentKey(workItemId: string): string {
  return `dashboard:incident:${workItemId}`;
}

// Severity dominates the sort order (matches PostgresWorkItemRepository's
// listActive: severity, then firstSignalAt) — 1e13 keeps it strictly
// dominant against any realistic epoch-ms value, with firstSignalAt
// breaking ties within a severity.
function activeScore(workItem: Pick<WorkItem, "severity" | "firstSignalAt">): number {
  const rank = SEVERITY_RANK[workItem.severity] ?? SEVERITY_RANK["P3"] ?? 3;
  return rank * 1e13 + workItem.firstSignalAt.getTime();
}

export interface IncidentSummary {
  readonly id: string;
  readonly componentId: string;
  readonly componentType: string;
  readonly severity: string;
  readonly state: string;
  readonly title: string;
  readonly firstSignalAt: string;
  readonly signalCount: number;
  readonly updatedAt: string;
}

export interface ActiveIncidentPage {
  readonly ids: readonly string[];
  readonly total: number;
}

export class DashboardCacheRepository {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  /**
   * Upserts the incident summary + active-set membership, or removes it
   * if the work item is CLOSED — CLOSED work items are deliberately not
   * part of the active-incident cache at all (see docs/data-model.md).
   * Returns the summary written, or null if this call removed the entry
   * instead.
   */
  async upsertActiveIncident(workItem: WorkItem): Promise<IncidentSummary | null> {
    if (workItem.state === "CLOSED") {
      await this.removeIncident(workItem.id);
      return null;
    }

    const summary: IncidentSummary = {
      id: workItem.id,
      componentId: workItem.componentId,
      componentType: workItem.componentType,
      severity: workItem.severity,
      state: workItem.state,
      title: workItem.title,
      firstSignalAt: workItem.firstSignalAt.toISOString(),
      signalCount: workItem.signalCount,
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      this.redis.set(incidentKey(workItem.id), JSON.stringify(summary), "EX", this.ttlSeconds),
      this.redis.zadd(ACTIVE_INCIDENTS_KEY, activeScore(workItem), workItem.id),
    ]);

    return summary;
  }

  async removeIncident(workItemId: string): Promise<void> {
    await Promise.all([
      this.redis.del(incidentKey(workItemId)),
      this.redis.zrem(ACTIVE_INCIDENTS_KEY, workItemId),
    ]);
  }

  /** Null on a miss — the TTL expired, it was never populated, or it's not (or no longer) active. Caller repopulates. */
  async getIncidentSummary(workItemId: string): Promise<IncidentSummary | null> {
    const raw = await this.redis.get(incidentKey(workItemId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as IncidentSummary;
  }

  /** Severity-then-recency order comes for free from the ZSET's score encoding — see docs/data-model.md. */
  async getActiveIncidentIds(pagination: { limit: number; offset: number }): Promise<ActiveIncidentPage> {
    const [total, ids] = await Promise.all([
      this.redis.zcard(ACTIVE_INCIDENTS_KEY),
      this.redis.zrange(ACTIVE_INCIDENTS_KEY, pagination.offset, pagination.offset + pagination.limit - 1),
    ]);
    return { ids, total };
  }
}

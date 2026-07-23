import type { Redis } from "ioredis";
import type { WorkItem } from "@prisma/client";

// Matches the read path described in docs/architecture.md: a sorted set
// of active incidents (for the dashboard's Live Feed) plus a per-incident
// summary hash (for Incident Detail), both write-through from the worker.
// No dashboard API reads these yet — that's a separate, not-yet-built
// piece — but the worker's "refresh the affected cache entries" step
// needs somewhere real to write to, per the pipeline this wires up.
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

export class DashboardCacheRepository {
  constructor(private readonly redis: Redis) {}

  /** Upserts the incident summary + active-set membership, or removes it if the work item is CLOSED. */
  async upsertActiveIncident(workItem: WorkItem): Promise<void> {
    if (workItem.state === "CLOSED") {
      await this.removeIncident(workItem.id);
      return;
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
      this.redis.set(incidentKey(workItem.id), JSON.stringify(summary)),
      this.redis.zadd(ACTIVE_INCIDENTS_KEY, activeScore(workItem), workItem.id),
    ]);
  }

  async removeIncident(workItemId: string): Promise<void> {
    await Promise.all([
      this.redis.del(incidentKey(workItemId)),
      this.redis.zrem(ACTIVE_INCIDENTS_KEY, workItemId),
    ]);
  }
}

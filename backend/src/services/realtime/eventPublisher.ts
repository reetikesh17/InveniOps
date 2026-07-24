import type { Logger } from "pino";
import type { WorkItem } from "@prisma/client";
import { toIncidentSummary } from "../dashboard/dashboardProjection.js";
import { INCIDENT_EVENTS_CHANNEL, type IncidentEvent } from "./incidentEvents.js";

// Narrow — the real ioredis `Redis` client satisfies this without an
// adapter (PUBLISH is a normal command, not restricted to subscriber-mode
// connections — see eventSubscriber.ts for the connection that IS
// restricted), but a unit test can substitute a one-method fake.
export interface PublishableRedis {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * Publishes to a plain Redis pub/sub channel — any regular (non-subscriber-mode)
 * Redis connection can PUBLISH, so this reuses the general-purpose `redis`
 * singleton rather than needing a dedicated connection (unlike the
 * subscriber side — see eventSubscriber.ts). A publish failure is logged
 * and dropped, never thrown: a missed real-time push must never block or
 * fail the actual mutation it's describing, same rule as alert dispatch and
 * metrics writes.
 *
 * Deliberately satisfies BatchEventPublisher (processBatch.ts) and
 * WorkflowEventPublisher (workflowService.ts) structurally, without
 * importing either — same narrow-interface-per-consumer pattern as
 * AlertDispatcher/MetricsWriter satisfying BatchAlertDispatcher/
 * BatchMetricsWriter without declaring `implements`.
 */
export class IncidentEventPublisher {
  constructor(
    private readonly redis: PublishableRedis,
    private readonly logger?: Pick<Logger, "error">,
  ) {}

  async publishWorkItemCreated(workItem: WorkItem): Promise<void> {
    await this.safePublish({ type: "work_item_created", incident: toIncidentSummary(workItem) });
  }

  async publishWorkItemStateChanged(workItem: WorkItem, fromState: string, toState: string): Promise<void> {
    await this.safePublish({
      type: "work_item_state_changed",
      incident: toIncidentSummary(workItem),
      fromState,
      toState,
    });
  }

  private async safePublish(event: IncidentEvent): Promise<void> {
    try {
      await this.redis.publish(INCIDENT_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (error) {
      this.logger?.error({ error, eventType: event.type }, "failed to publish incident event");
    }
  }
}

import type { Logger } from "pino";
import type { WorkItem } from "@prisma/client";
import { getEscalationPolicy, reconcileSeverity, type AlertStrategyRegistry } from "../../domain/alerting/index.js";
import type { AlertDispatcher } from "./dispatcher.js";

export interface EscalationWorkItemStore {
  findOpenWorkItemsOlderThan(cutoff: Date): Promise<WorkItem[]>;
  recordEscalation(workItemId: string, actor: string): Promise<void>;
}

export interface EscalationSchedulerOptions {
  readonly checkIntervalMs: number;
}

const ESCALATION_ACTOR = "system:escalation";

/**
 * Periodically checks for work items still OPEN past their strategy's
 * escalation delay, re-dispatches through the escalation channel, and
 * records the event on the audit trail. "Escalate at most once per level"
 * is enforced by the dispatcher's Redis claim (dispatchEscalation only
 * returns true once per work item); "stop escalating once state leaves
 * OPEN" falls out of the query itself — a work item that transitioned
 * away from OPEN simply stops appearing in it on the next tick, no
 * separate acknowledge step needed.
 */
export class EscalationScheduler {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly workItemStore: EscalationWorkItemStore,
    private readonly strategyRegistry: AlertStrategyRegistry,
    private readonly dispatcher: AlertDispatcher,
    private readonly options: EscalationSchedulerOptions,
    private readonly logger?: Pick<Logger, "info" | "warn" | "error">,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger?.error({ error }, "escalation scheduler tick failed");
      });
    }, this.options.checkIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    const now = new Date();
    const candidates = await this.workItemStore.findOpenWorkItemsOlderThan(this.widestPossibleCutoff(now));
    await Promise.all(candidates.map((workItem) => this.maybeEscalate(workItem, now)));
  }

  /**
   * The Postgres query needs one concrete cutoff, but escalation delay is
   * per-severity — so it queries with the shortest delay across all
   * severities (P0's) to get a superset of true candidates, then
   * maybeEscalate() re-checks each one against its own actual delay.
   * Simpler than a per-severity query, and the candidate set at any
   * reasonable check interval is small.
   */
  private widestPossibleCutoff(now: Date): Date {
    const shortestDelayMs = getEscalationPolicy("P0").acknowledgeWithinMs;
    return new Date(now.getTime() - shortestDelayMs);
  }

  private async maybeEscalate(workItem: WorkItem, now: Date): Promise<void> {
    const strategy = this.strategyRegistry.resolve(workItem.componentType);
    const reconciledSeverity = reconcileSeverity(strategy.severityFloor, workItem.severity);
    const policy = getEscalationPolicy(reconciledSeverity);
    const overdueSince = new Date(workItem.firstSignalAt.getTime() + policy.acknowledgeWithinMs);

    if (now < overdueSince) {
      return; // in the widened candidate set, but not overdue at its own severity yet
    }

    const escalated = await this.dispatcher.dispatchEscalation(workItem);
    if (escalated) {
      await this.workItemStore.recordEscalation(workItem.id, ESCALATION_ACTOR);
    }
  }
}

import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { WorkItem } from "@prisma/client";
import { retry } from "../../utils/retry.js";
import type { AlertMetricsRecorder } from "../../utils/metrics.js";
import type { WorkItemStateName } from "../../domain/state/index.js";
import {
  getEscalationPolicy,
  type Alert,
  type AlertContext,
  type AlertStrategyRegistry,
  type NotificationChannel,
} from "../../domain/alerting/index.js";
import type { Notifier } from "./notifiers/types.js";
import type { NotifierRegistry } from "./notifierRegistry.js";
import { claimAlertDelivery, claimEscalationLevel } from "./suppression.js";
import type { AlertDispatchPoint } from "../../repositories/metrics/index.js";

export type AlertEventType = "created" | WorkItemStateName;

// Single tier today — domain/alerting's EscalationPolicy has exactly one
// (acknowledgeWithinMs, escalateTo) per severity. Tracked as a level
// number in Redis (see suppression.ts#claimEscalationLevel) so a future
// multi-tier policy slots in without redesigning the claim mechanism.
const ESCALATION_LEVEL = 1;

const EVENT_LABELS: Readonly<Record<AlertEventType, string>> = {
  created: "New incident opened",
  OPEN: "Incident reopened",
  INVESTIGATING: "Incident moved to INVESTIGATING",
  RESOLVED: "Incident marked RESOLVED",
  CLOSED: "Incident CLOSED",
};

export interface AlertDispatcherOptions {
  readonly maxAttempts: number;
  readonly backoffDelayMs: number;
  readonly suppressionWindowSeconds: number;
}

/** Never throws — see src/services/aggregation/metricsWriter.ts. */
export interface AlertDispatchMetricsWriter {
  recordAlertDispatches(points: readonly AlertDispatchPoint[]): Promise<void>;
}

function toContext(workItem: WorkItem): AlertContext {
  return {
    componentId: workItem.componentId,
    componentType: workItem.componentType,
    reportedSeverity: workItem.severity,
    signalCount: workItem.signalCount,
    firstSignalAt: workItem.firstSignalAt,
  };
}

function withEventFraming(alert: Alert, eventType: AlertEventType, workItem: WorkItem): Alert {
  const label = EVENT_LABELS[eventType];
  return {
    ...alert,
    title: `${label}: ${alert.title}`,
    body: `${label} — work item ${workItem.id}, ${workItem.signalCount} signal(s) so far.\n${alert.body}`,
  };
}

/**
 * Resolves the strategy for a work item's component, renders the alert,
 * and fans out to that strategy's channels concurrently. Never throws —
 * "delivery failures never block or fail the pipeline" is enforced here,
 * not left to callers to remember. Dedup is two-layer, same pattern as
 * the debouncer: callers only invoke dispatch() for genuinely new events
 * (e.g. the worker only calls it when resolveBatch reported created:true),
 * and a Redis SET NX claim is the actual backstop against a restart or a
 * second replica double-sending — see suppression.ts.
 */
export class AlertDispatcher {
  constructor(
    private readonly strategyRegistry: AlertStrategyRegistry,
    private readonly notifierRegistry: NotifierRegistry,
    private readonly redis: Redis,
    private readonly options: AlertDispatcherOptions,
    private readonly metrics?: AlertMetricsRecorder,
    private readonly logger?: Pick<Logger, "info" | "warn" | "error">,
    // A *provider*, not a MetricsWriter instance directly: this class is
    // constructed eagerly at module load (services/alerting/alertingInstance.ts),
    // before src/index.ts's connectClients() has run, but the real
    // MetricsWriter needs a live Mongo connection (see
    // services/aggregation/aggregationInstance.ts). Deferring resolution to
    // dispatch time — well after boot — sidesteps that ordering problem
    // without making this class eager about a dependency it doesn't need
    // until the first alert actually goes out.
    private readonly metricsWriterProvider?: () => AlertDispatchMetricsWriter | undefined,
  ) {}

  async dispatch(workItem: WorkItem, eventType: AlertEventType): Promise<void> {
    try {
      const claimed = await claimAlertDelivery(
        this.redis,
        workItem.id,
        eventType,
        this.options.suppressionWindowSeconds,
      );
      if (!claimed) {
        return;
      }

      const context = toContext(workItem);
      const strategy = this.strategyRegistry.resolve(workItem.componentType);
      const alert = withEventFraming(strategy.buildAlert(context), eventType, workItem);

      await this.fanOut(alert, context, workItem.id);
    } catch (error) {
      this.logger?.error({ error, workItemId: workItem.id, eventType }, "alert dispatch failed unexpectedly");
    }
  }

  /**
   * Escalation is a separate entry point: it claims its own (level-based)
   * Redis key rather than dispatch()'s per-eventType key, targets only the
   * severity's escalation channel (not the strategy's full channel list),
   * and reports back whether it actually escalated so the caller (the
   * scheduler) knows whether to also write the audit-trail row. Never
   * throws, same as dispatch().
   */
  async dispatchEscalation(workItem: WorkItem): Promise<boolean> {
    try {
      const claimed = await claimEscalationLevel(
        this.redis,
        workItem.id,
        ESCALATION_LEVEL,
        this.options.suppressionWindowSeconds,
      );
      if (!claimed) {
        return false;
      }

      const context = toContext(workItem);
      const strategy = this.strategyRegistry.resolve(workItem.componentType);
      const baseAlert = strategy.buildAlert(context);
      const escalation = getEscalationPolicy(baseAlert.severity);
      const alert = withEventFraming({ ...baseAlert, channels: [escalation.escalateTo] }, "created", workItem);

      await this.fanOut(alert, context, workItem.id);
      this.metrics?.recordEscalation();
      return true;
    } catch (error) {
      this.logger?.error({ error, workItemId: workItem.id }, "escalation dispatch failed unexpectedly");
      return false;
    }
  }

  private async fanOut(alert: Alert, context: AlertContext, workItemId: string): Promise<void> {
    const targets: readonly Notifier[] = [
      this.notifierRegistry.console,
      ...alert.channels
        .map((channel: NotificationChannel) => this.notifierRegistry.resolve(channel))
        .filter((notifier): notifier is Notifier => notifier !== undefined),
    ];

    await Promise.all(targets.map((notifier) => this.sendVia(notifier, alert, context, workItemId)));
  }

  private async sendVia(notifier: Notifier, alert: Alert, context: AlertContext, workItemId: string): Promise<void> {
    try {
      await retry(() => notifier.send(alert, context), {
        attempts: this.options.maxAttempts,
        baseDelayMs: this.options.backoffDelayMs,
      });
      this.metrics?.recordDeliverySuccess(notifier.name);
      await this.recordDispatchMetric(notifier.name, "delivered");
    } catch (error) {
      this.metrics?.recordDeliveryFailure(notifier.name);
      await this.recordDispatchMetric(notifier.name, "failed");
      this.logger?.error(
        { error, channel: notifier.name, workItemId },
        "alert delivery failed after exhausting retries",
      );
      // Swallow — never rethrow. One channel failing must never affect the
      // others (this runs inside a Promise.all) or the caller.
    }
  }

  /**
   * The real MetricsWriter never throws (it drops and logs internally),
   * but this guarantee shouldn't depend on that discipline holding for
   * every possible implementation of the interface — wrapped here too, so
   * a misbehaving metrics writer still can't affect alert delivery.
   */
  private async recordDispatchMetric(channel: string, outcome: "delivered" | "failed"): Promise<void> {
    const writer = this.metricsWriterProvider?.();
    if (!writer) {
      return;
    }
    try {
      await writer.recordAlertDispatches([{ ts: new Date(), channel, outcome }]);
    } catch (error) {
      this.logger?.error({ error, channel }, "alert dispatch metrics write failed unexpectedly");
    }
  }
}

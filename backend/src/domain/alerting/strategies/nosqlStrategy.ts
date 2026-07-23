import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/**
 * Floor P1: the raw signal audit log. Losing it doesn't take the write
 * path down (the ingestion buffer and work-item lifecycle live in
 * Postgres/Redis), but it's the only record of what actually happened for
 * every incident, current and historical — serious, one notch under a
 * source-of-truth outage.
 */
export class NosqlAlertStrategy implements AlertStrategy {
  readonly componentType = "NOSQL";
  readonly severityFloor = "P1" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["pagerduty", "slack"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] Signal store failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. Raw signal persistence is degraded or down — incident detail and historical audit trail are at risk even if ingestion itself keeps accepting traffic.`,
    };
  }
}

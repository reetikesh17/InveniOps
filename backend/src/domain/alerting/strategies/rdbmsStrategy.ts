import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/**
 * Floor P0: the relational store is the system's source of truth and a
 * shared dependency for every other component — an outage here is never
 * "wait and see," regardless of what any individual signal reported.
 */
export class RdbmsAlertStrategy implements AlertStrategy {
  readonly componentType = "RDBMS";
  readonly severityFloor = "P0" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["pagerduty", "slack"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] RDBMS failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. The relational store is the source of truth for work items and RCAs — treat as an active, system-wide outage until confirmed otherwise.`,
    };
  }
}

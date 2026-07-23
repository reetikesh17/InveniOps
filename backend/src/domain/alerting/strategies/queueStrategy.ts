import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/** Floor P1: the async processing queue. Degrades gracefully — ingestion keeps accepting via the buffer even if this backs up — but a growing backlog still needs attention before it becomes an outage. */
export class QueueAlertStrategy implements AlertStrategy {
  readonly componentType = "QUEUE";
  readonly severityFloor = "P1" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["slack"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] Queue failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. Async processing is degraded or backed up — work items may lag behind ingestion until this clears.`,
    };
  }
}

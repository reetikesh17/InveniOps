import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/** Floor P1: the customer-facing surface. Not the top floor (RDBMS still outranks it), but always paged, never left to email alone. */
export class ApiAlertStrategy implements AlertStrategy {
  readonly componentType = "API";
  readonly severityFloor = "P1" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["pagerduty", "slack"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] API failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. Customer-facing traffic is likely affected — verify request success rate and latency immediately.`,
    };
  }
}

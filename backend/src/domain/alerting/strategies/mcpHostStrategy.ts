import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/** Floor P1: internal tooling host. Important to the team operating the system, but not directly customer-facing — Slack + email, no pager. */
export class McpHostAlertStrategy implements AlertStrategy {
  readonly componentType = "MCP_HOST";
  readonly severityFloor = "P1" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["slack", "email"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] MCP host failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. Internal tooling/model-context host is degraded — check whether dependent automations are affected.`,
    };
  }
}

import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/**
 * Fallback for any component type without a dedicated strategy — a
 * conservative, generic policy rather than a crash or a silent no-op.
 * Registering a real strategy for a new component type (see registry.ts)
 * always takes precedence over this one.
 */
export class DefaultAlertStrategy implements AlertStrategy {
  readonly componentType = "DEFAULT";
  readonly severityFloor = "P2" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["email"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] Failure on ${context.componentId} (${context.componentType})`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. No dedicated alert policy exists for component type "${context.componentType}" — using the default policy. Consider registering a specific strategy for it.`,
    };
  }
}

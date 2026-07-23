import { reconcileSeverity } from "../severity.js";
import { getEscalationPolicy } from "../escalation.js";
import type { Alert, AlertContext, AlertStrategy } from "../types.js";

/**
 * Floor P2: the dashboard hot-path cache. A failure degrades latency, not
 * correctness — reads fall back to Postgres on a miss (see
 * docs/data-model.md) — so this is real but not urgent by default. Matches
 * the assignment's own example (P2 for Cache failure).
 */
export class CacheAlertStrategy implements AlertStrategy {
  readonly componentType = "CACHE";
  readonly severityFloor = "P2" as const;

  buildAlert(context: AlertContext): Alert {
    const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
    return {
      severity,
      channels: ["slack"],
      escalation: getEscalationPolicy(severity),
      title: `[${severity}] Cache failure on ${context.componentId}`,
      body: `${context.signalCount} signal(s) since ${context.firstSignalAt.toISOString()}. Dashboard reads will fall back to Postgres and run slower, but data is not at risk.`,
    };
  }
}

import type { Severity } from "../types";

// The single source for severity metadata across the console. Colour lives in
// exactly one place per severity (the CSS var), so the spine, the age dot, the
// badge, the header ribbon, and the charts all draw the same hue.
export const SEVERITY_WORD: Record<Severity, string> = {
  P0: "Critical",
  P1: "High",
  P2: "Medium",
  P3: "Low",
};

export const SEVERITY_COLOR_VAR: Record<Severity, string> = {
  P0: "var(--color-severity-p0)",
  P1: "var(--color-severity-p1)",
  P2: "var(--color-severity-p2)",
  P3: "var(--color-severity-p3)",
};

export function severityColor(severity: string): string {
  return SEVERITY_COLOR_VAR[severity as Severity] ?? "var(--color-ink-faint)";
}

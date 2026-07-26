import { COMPONENT_TYPES, SEVERITIES, type ComponentType, type Severity } from "../../types";

// Chart palettes come from the dataviz method (validated with its
// scripts/validate_palette.js), NOT hand-picked, and are deliberately
// distinct per encoding job:
//
//  - componentType is *nominal identity* → the documented categorical
//    palette, first six slots in fixed order (the order is the CVD-safety
//    mechanism, never cycled). Validated adjacent, light surface: worst pair
//    ΔE 9.1 (>8 target). Contrast sits below 3:1 for a few fills, so every
//    chart using these ships the relief channel the validator requires — a
//    legend plus hover labels (and the health table) — never colour alone.
//
//  - severity is *ordinal* (P0 worst → P3 least), so it takes a single-hue
//    red ramp, darker = more severe — which also preserves the "red =
//    critical" model the SeverityBadge uses elsewhere. Validated --ordinal:
//    monotone L, adjacent ΔL ≥ 0.06, light end 2.69:1. The app's four badge
//    hues (red/orange/amber/sky) were rejected as chart series: orange↔amber
//    measure ΔE 1.6 under CVD, indistinguishable as adjacent stack segments.
//
//  - MTTR avg vs rolling is one measure shown two ways → emphasis: one blue
//    hue, a faint raw-average line under a bold rolling line, no second hue.

/** Fixed order — the CVD-safety mechanism. Never reordered, never cycled. */
export const COMPONENT_TYPE_COLORS: Record<ComponentType, string> = {
  API: "#2a78d6", // slot 1 blue
  MCP_HOST: "#eb6834", // slot 2 orange
  CACHE: "#1baf7a", // slot 3 aqua
  QUEUE: "#eda100", // slot 4 yellow
  RDBMS: "#e87ba4", // slot 5 magenta
  NOSQL: "#008300", // slot 6 green
};

/** Red ordinal ramp, P0 (darkest) → P3 (lightest). */
export const SEVERITY_COLORS: Record<Severity, string> = {
  P0: "#7f1d1d",
  P1: "#b91c1c",
  P2: "#ef4444",
  P3: "#f87171",
};

export const MTTR_AVG_COLOR = "#9ec5f4"; // faint raw average (blue step 200)
export const MTTR_ROLLING_COLOR = "#2a78d6"; // bold rolling overlay (blue slot 1)
export const THROUGHPUT_COLOR = "#2a78d6"; // single-series line

// Chart chrome — the app's neutral tokens as concrete hex (recharts needs
// real colours on SVG stroke props, not CSS custom properties).
export const CHART_INK = "#171717";
export const CHART_INK_MUTED = "#737373";
export const CHART_GRID = "#e5e5e5";
export const CHART_AXIS = "#d4d4d4";
export const CHART_SURFACE = "#ffffff";

/** Ordered arrays so legends/stacks always render in the fixed palette order. */
export const COMPONENT_TYPE_ORDER: readonly ComponentType[] = COMPONENT_TYPES;
export const SEVERITY_ORDER: readonly Severity[] = SEVERITIES;

export function colorForComponentType(value: string): string {
  return COMPONENT_TYPE_COLORS[value as ComponentType] ?? CHART_INK_MUTED;
}

export function colorForSeverity(value: string): string {
  return SEVERITY_COLORS[value as Severity] ?? CHART_INK_MUTED;
}

/**
 * Time-axis tick formatter whose granularity adapts to the visible span, so
 * a 15-minute range shows clock time and a 7-day range shows dates — without
 * the frontend ever re-bucketing (the server owns bucket boundaries; this
 * only labels them).
 */
export function makeTimeTickFormatter(fromMs: number, toMs: number): (iso: string) => string {
  const spanMs = toMs - fromMs;
  const oneDay = 86_400_000;
  return (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    if (spanMs <= oneDay) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (spanMs <= 7 * oneDay) {
      return date.toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  };
}

/** Full timestamp for tooltips (they can afford the width the axis can't). */
export function formatBucketFull(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

import { useEffect, useState } from "react";
import { COMPONENT_TYPES, SEVERITIES, type ComponentType, type Severity } from "../../types";

// Encoding jobs:
//  - severity series reuse the app's four severity tokens (read live from CSS
//    so charts follow the theme) — the same hues as the feed spine.
//  - componentType is nominal identity → a categorical palette (analytics is a
//    data view where categorical colour is legitimate; the console chrome
//    stays rationed). Kept desaturated-ish to sit inside the instrument look.
//  - single-series throughput and MTTR avg/rolling are NEUTRAL (ink tones):
//    colour is reserved for identity/severity, so a lone trend line is grey,
//    and MTTR's two lines separate by brightness + weight, not a second hue.

/** Fixed order — never reordered/cycled. */
export const COMPONENT_TYPE_COLORS: Record<ComponentType, string> = {
  API: "#3d7fb8",
  MCP_HOST: "#c06a3e",
  CACHE: "#3f9284",
  QUEUE: "#b89a52",
  RDBMS: "#b06f8f",
  NOSQL: "#5f8f5a",
};

export const COMPONENT_TYPE_ORDER: readonly ComponentType[] = COMPONENT_TYPES;
export const SEVERITY_ORDER: readonly Severity[] = SEVERITIES;

export function colorForComponentType(value: string): string {
  return COMPONENT_TYPE_COLORS[value as ComponentType] ?? "#8a949b";
}

export interface ChartColors {
  readonly ink: string;
  readonly inkMuted: string;
  readonly grid: string;
  readonly axis: string;
  readonly surface: string;
  /** Single-series line / bold overlay — neutral. */
  readonly line: string;
  /** Faint companion line (MTTR bucket average). */
  readonly lineFaint: string;
  colorForSeverity: (value: string) => string;
  colorForComponentType: (value: string) => string;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function snapshot(): ChartColors {
  const ink = readVar("--color-ink", "#d6dddf");
  const inkMuted = readVar("--color-ink-muted", "#8a949b");
  const severity: Record<Severity, string> = {
    P0: readVar("--color-severity-p0", "#e0685c"),
    P1: readVar("--color-severity-p1", "#e0a64f"),
    P2: readVar("--color-severity-p2", "#4fa093"),
    P3: readVar("--color-severity-p3", "#6c7c96"),
  };
  return {
    ink,
    inkMuted,
    grid: readVar("--color-border", "#232b2f"),
    axis: readVar("--color-border-strong", "#2f383d"),
    surface: readVar("--color-surface", "#151b1e"),
    line: ink,
    lineFaint: inkMuted,
    colorForSeverity: (value) => severity[value as Severity] ?? inkMuted,
    colorForComponentType,
  };
}

/**
 * Resolved chart colours for the current theme. Recharts needs concrete colour
 * strings on SVG props (CSS var() doesn't resolve as an attribute), so this
 * reads the computed token values and re-reads when the theme changes
 * (data-theme flips, or the OS preference does) so charts follow light/dark.
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(snapshot);

  useEffect(() => {
    const refresh = (): void => setColors(snapshot());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", refresh);
    };
  }, []);

  return colors;
}

/** Time-axis tick formatter whose granularity adapts to the visible span. */
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
      return date.toLocaleString([], {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
  };
}

/** Full timestamp for tooltips. */
export function formatBucketFull(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

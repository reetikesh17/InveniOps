import type { Severity } from "../types";

interface SeverityConfig {
  readonly word: string;
  /** How many of the 4 signal bars are filled — a colour-independent magnitude cue, see SeverityBars below. */
  readonly bars: number;
  readonly className: string;
}

const CONFIG: Record<Severity, SeverityConfig> = {
  P0: { word: "Critical", bars: 4, className: "bg-severity-p0 text-white" },
  P1: { word: "High", bars: 3, className: "bg-severity-p1 text-white" },
  P2: { word: "Medium", bars: 2, className: "bg-severity-p2 text-white" },
  P3: { word: "Low", bars: 1, className: "bg-severity-p3 text-white" },
};

/**
 * A small signal-strength-style glyph: more filled bars = more severe.
 * Reads correctly in greyscale or under any colour-vision deficiency,
 * independent of the badge's background hue — the redundant encoding this
 * component exists for. The unfilled bars stay in the DOM at low opacity
 * (not removed) so the *shape* — 4 bars, some filled — is identical across
 * every severity; only the fill count changes.
 */
function SeverityBars({ filled }: { filled: number }): JSX.Element {
  return (
    <svg viewBox="0 0 15 10" className="h-2.5 w-4 shrink-0" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => {
        const height = 2.5 + i * 2.5;
        return (
          <rect
            key={i}
            x={i * 4}
            y={10 - height}
            width="3"
            height={height}
            className={i < filled ? "fill-current" : "fill-current opacity-30"}
          />
        );
      })}
    </svg>
  );
}

export interface SeverityBadgeProps {
  readonly severity: Severity;
  readonly className?: string;
}

/**
 * Never relies on colour alone: the hue differs per severity, but the
 * "P0"/"P1"/etc. text label and the bar-count icon both carry the same
 * meaning independently — either one alone is enough to read severity
 * correctly. The full word ("Critical", "High", ...) is one hover away via
 * `title` rather than shown inline, to keep this compact in a dense table.
 */
export function SeverityBadge({ severity, className = "" }: SeverityBadgeProps): JSX.Element {
  const config = CONFIG[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${config.className} ${className}`}
      title={`Severity ${severity} — ${config.word}`}
    >
      <SeverityBars filled={config.bars} />
      {severity}
    </span>
  );
}

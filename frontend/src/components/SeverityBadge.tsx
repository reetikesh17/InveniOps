import type { Severity } from "../types";
import { SEVERITY_COLOR_VAR, SEVERITY_WORD } from "./severity";

export interface SeverityBadgeProps {
  readonly severity: Severity;
  readonly className?: string;
}

/**
 * Compact severity marker for contexts that aren't the feed row (incident
 * header, raw signals, legends) — a rationed colour dot plus the mono code.
 * Colour rides on the dot only; the "P0" code and the hover word carry the
 * meaning independently, so it survives greyscale and colour-blindness. The
 * filled pill is gone — in the feed, severity is the leading spine instead.
 */
export function SeverityBadge({ severity, className = "" }: SeverityBadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={`Severity ${severity} — ${SEVERITY_WORD[severity]}`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: SEVERITY_COLOR_VAR[severity] }}
        aria-hidden="true"
      />
      <span className="font-mono text-mono-id font-medium tabular-nums text-ink">{severity}</span>
    </span>
  );
}

import { useEffect, useState } from "react";
import { RelativeTime } from "../../components";
import type { WorkItemState } from "../../types";

// Only OPEN/INVESTIGATING are "still needs a human" states — RESOLVED/CLOSED
// never escalate no matter how old.
const ESCALATING_STATES: readonly WorkItemState[] = ["OPEN", "INVESTIGATING"];

const ELEVATED_AFTER_MS = 10 * 60_000;
const CRITICAL_AFTER_MS = 30 * 60_000;
const TICK_MS = 15_000;

// Escalation is NEUTRAL — colour is rationed to severity, so "how long" climbs
// an ink weight ramp (quiet → full → bold) and gains a ▲, rather than turning
// red. The severity hue stays on the spine alone. Both quiet rungs share the
// same ink-muted colour (ink-faint fails AA text contrast at this size — see
// docs/decisions/0008-console-visual-system.md) and are told apart by style,
// not colour: resolved/closed is italic (it's also already named by the STATE
// badge beside it), a fresh open incident is upright.
function tier(elapsedMs: number, escalates: boolean): { className: string; marker: boolean } {
  if (!escalates) {
    return { className: "italic text-ink-muted", marker: false };
  }
  if (elapsedMs >= CRITICAL_AFTER_MS) {
    return { className: "font-semibold text-ink", marker: true };
  }
  if (elapsedMs >= ELEVATED_AFTER_MS) {
    return { className: "font-medium text-ink", marker: true };
  }
  return { className: "text-ink-muted", marker: false };
}

export interface TimeInStateIndicatorProps {
  readonly since: string;
  readonly state: WorkItemState;
  readonly className?: string;
}

export function TimeInStateIndicator({
  since,
  state,
  className = "",
}: TimeInStateIndicatorProps): JSX.Element {
  const sinceMs = new Date(since).getTime();
  const escalates = ESCALATING_STATES.includes(state);
  const [elapsedMs, setElapsedMs] = useState<number>(() => Date.now() - sinceMs);

  useEffect(() => {
    if (!escalates || Number.isNaN(sinceMs)) {
      return undefined;
    }
    const timer = setInterval(() => setElapsedMs(Date.now() - sinceMs), TICK_MS);
    return () => clearInterval(timer);
  }, [sinceMs, escalates]);

  const { className: tierClass, marker } = tier(elapsedMs, escalates);

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono tabular-nums ${tierClass} ${className}`}
    >
      <RelativeTime value={since} />
      {/* Sized relative to the surrounding text (not an absolute px) so it
          always scales with wherever this indicator is used. */}
      {marker && (
        <span aria-hidden="true" className="text-[0.7em] leading-none">
          ▲
        </span>
      )}
    </span>
  );
}

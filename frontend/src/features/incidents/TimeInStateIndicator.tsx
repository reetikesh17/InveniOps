import { useEffect, useState } from "react";
import { RelativeTime } from "../../components";
import type { WorkItemState } from "../../types";

// Only OPEN/INVESTIGATING are "still needs a human" states — RESOLVED and
// CLOSED sitting around for a while isn't an operational problem, so they
// never escalate visually, no matter how old updatedAt gets.
const ESCALATING_STATES: readonly WorkItemState[] = ["OPEN", "INVESTIGATING"];

const ELEVATED_AFTER_MS = 10 * 60_000;
const CRITICAL_AFTER_MS = 30 * 60_000;
const TICK_MS = 15_000;

function tierClassName(elapsedMs: number, escalates: boolean): string {
  if (!escalates) {
    return "text-ink-muted";
  }
  if (elapsedMs >= CRITICAL_AFTER_MS) {
    return "font-semibold text-severity-p0";
  }
  if (elapsedMs >= ELEVATED_AFTER_MS) {
    return "font-medium text-severity-p2";
  }
  return "text-ink-muted";
}

export interface TimeInStateIndicatorProps {
  readonly since: string;
  readonly state: WorkItemState;
  readonly className?: string;
}

/**
 * Wraps RelativeTime (same "Xm ago" text, same absolute-time hover) but adds
 * an escalating colour/weight the longer an incident sits in an unaddressed
 * state — so a P1 stuck in OPEN for 40 minutes reads as urgent at a glance,
 * not just as quiet-looking text identical to a fresh one.
 */
export function TimeInStateIndicator({ since, state, className = "" }: TimeInStateIndicatorProps): JSX.Element {
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

  return <RelativeTime value={since} className={`${tierClassName(elapsedMs, escalates)} ${className}`} />;
}

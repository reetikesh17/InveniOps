import { useEffect, useState } from "react";
import type { Severity, WorkItemState } from "../types";
import { SEVERITY_COLOR_VAR } from "./severity";

// The second half of the severity spine: an age gauge in the leading gutter.
// Hollow ring when fresh; fills solid once an incident has sat in an
// unaddressed state past the threshold — so a stale P0 reads as a bright,
// FULL dot and a fresh P3 as a dim, empty ring. Answers "how long" in the
// same 12px of leading edge the rail answers "how bad".
const AGED_AFTER_MS = 10 * 60_000;
const TICK_MS = 30_000;

// Only OPEN/INVESTIGATING escalate — a RESOLVED/CLOSED incident sitting a
// while isn't an operational clock, so its dot stays a quiet ring.
const ESCALATING: readonly WorkItemState[] = ["OPEN", "INVESTIGATING"];

export interface AgeDotProps {
  readonly severity: Severity;
  readonly since: string;
  readonly state: WorkItemState;
}

export function AgeDot({ severity, since, state }: AgeDotProps): JSX.Element {
  const sinceMs = new Date(since).getTime();
  const escalates = ESCALATING.includes(state);
  const [aged, setAged] = useState<boolean>(
    () => escalates && Date.now() - sinceMs >= AGED_AFTER_MS,
  );

  useEffect(() => {
    if (!escalates || Number.isNaN(sinceMs)) {
      setAged(false);
      return undefined;
    }
    const check = (): void => setAged(Date.now() - sinceMs >= AGED_AFTER_MS);
    check();
    const timer = setInterval(check, TICK_MS);
    return () => clearInterval(timer);
  }, [sinceMs, escalates]);

  const color = SEVERITY_COLOR_VAR[severity];
  const title = `${severity} · ${aged ? "aged in state" : "recent"}`;

  return (
    <span
      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
      style={aged ? { backgroundColor: color } : { boxShadow: `inset 0 0 0 1.5px ${color}` }}
      title={title}
      aria-hidden="true"
    />
  );
}

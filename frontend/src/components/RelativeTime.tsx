import { useEffect, useState } from "react";

export interface RelativeTimeProps {
  readonly value: string | Date;
  readonly className?: string;
}

function formatRelative(fromMs: number, nowMs: number): string {
  const diffSeconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (diffSeconds < 5) {
    return "just now";
  }
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  return `${Math.round(months / 12)}y ago`;
}

// Update cadence scales with age — a timestamp from three days ago doesn't
// need a re-render every second. Chosen so "Xm ago" never visibly drifts
// more than a tick behind real time, regardless of age.
function nextTickDelayMs(diffSeconds: number): number {
  if (diffSeconds < 60) {
    return 1_000;
  }
  if (diffSeconds < 3_600) {
    return 30_000;
  }
  return 60_000;
}

/** Renders "4m ago", updating on an interval; the absolute timestamp is one hover away via the native `title` tooltip. */
export function RelativeTime({ value, className = "" }: RelativeTimeProps): JSX.Element {
  const date = typeof value === "string" ? new Date(value) : value;
  const timeMs = date.getTime();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(timeMs)) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const current = Date.now();
      setNow(current);
      const diffSeconds = Math.max(0, Math.round((current - timeMs) / 1000));
      timer = setTimeout(tick, nextTickDelayMs(diffSeconds));
    };
    const initialDiffSeconds = Math.max(0, Math.round((Date.now() - timeMs) / 1000));
    timer = setTimeout(tick, nextTickDelayMs(initialDiffSeconds));
    return () => clearTimeout(timer);
  }, [timeMs]);

  if (Number.isNaN(timeMs)) {
    return <span className={className}>—</span>;
  }

  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={className}>
      {formatRelative(timeMs, now)}
    </time>
  );
}

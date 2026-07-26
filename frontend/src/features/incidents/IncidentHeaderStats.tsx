import { useEffect, useState } from "react";
import { EYEBROW_CLASSES, SEVERITY_COLOR_VAR } from "../../components";
import { api } from "../../lib/api";
import { SEVERITIES, type Severity, type WorkItem } from "../../types";

const THROUGHPUT_POLL_MS = 5_000;
const THROUGHPUT_WINDOW_SECONDS = 60;

function countBySeverity(incidents: readonly WorkItem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const incident of incidents) {
    counts[incident.severity] += 1;
  }
  return counts;
}

/** Signals/sec over a trailing 60s window — the only true ingestion-rate source (debounced signals aren't 1:1 with incidents). */
function useIngestionThroughput(): number | null {
  const [signalsPerSecond, setSignalsPerSecond] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    async function poll(): Promise<void> {
      controller?.abort();
      controller = new AbortController();
      const to = new Date();
      const from = new Date(to.getTime() - THROUGHPUT_WINDOW_SECONDS * 1000);
      try {
        const response = await api.getThroughput(
          { from: from.toISOString(), to: to.toISOString(), interval: THROUGHPUT_WINDOW_SECONDS },
          { signal: controller.signal },
        );
        if (cancelled) return;
        const total = response.points.reduce((sum, point) => sum + point.count, 0);
        setSignalsPerSecond(total / THROUGHPUT_WINDOW_SECONDS);
      } catch {
        // header stat only — a transient failure just blanks this cycle
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), THROUGHPUT_POLL_MS);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(timer);
    };
  }, []);

  return signalsPerSecond;
}

export interface IncidentHeaderStatsProps {
  readonly incidents: readonly WorkItem[];
}

/**
 * The urgency profile: one segmented ribbon — the horizontal compression of
 * the row spines — split into severity-proportional runs, with mono counts.
 * The only chromatic element on the screen besides the rails, and it speaks
 * the same visual language. Lives in the global Header (not its own card —
 * the header's own chrome is the frame now), so system state is visible on
 * every route, not just the Live Feed.
 */
export function IncidentHeaderStats({ incidents }: IncidentHeaderStatsProps): JSX.Element {
  const counts = countBySeverity(incidents);
  const total = incidents.length;
  const throughput = useIngestionThroughput();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="flex items-center gap-4">
          <span className={EYEBROW_CLASSES}>Urgency profile</span>
          <div className="flex items-center gap-3">
            {SEVERITIES.map((severity) => (
              <span key={severity} className="inline-flex items-center gap-1.5" title={`${severity}: ${counts[severity]}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_COLOR_VAR[severity] }} aria-hidden="true" />
                {/* Not MONO_MICRO_CLASSES here — that forces lowercase, which would turn "P0" into "p0". */}
                <span className="font-mono text-mono-micro text-ink-muted">{severity}</span>
                <span className={`font-mono text-mono-num tabular-nums ${counts[severity] > 0 ? "text-ink" : "text-ink-muted"}`}>
                  {counts[severity]}
                </span>
              </span>
            ))}
          </div>
        </div>
        <span className="font-mono text-mono-micro tabular-nums text-ink-muted">
          {throughput === null ? "—" : throughput.toFixed(1)}
          <span className="text-ink-muted"> sig/s ingest</span>
        </span>
      </div>

      {/* Segmented severity ribbon — proportional runs, 1px gaps via the track. */}
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-sm bg-border" role="img" aria-label={`Active by severity: ${SEVERITIES.map((s) => `${counts[s]} ${s}`).join(", ")}`}>
        {total === 0
          ? null
          : SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
              <span
                key={severity}
                className="h-full"
                style={{ width: `${(counts[severity] / total) * 100}%`, backgroundColor: SEVERITY_COLOR_VAR[severity] }}
              />
            ))}
      </div>
    </div>
  );
}

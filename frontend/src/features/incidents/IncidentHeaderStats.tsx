import { useEffect, useState } from "react";
import { Card } from "../../components";
import { api } from "../../lib/api";
import { SEVERITIES, type Severity, type WorkItem } from "../../types";

// Matches the console reporter's own cadence elsewhere in this system (see
// useIncidents.ts's POLL_INTERVAL_MS) for a consistent "how fresh is this".
const THROUGHPUT_POLL_MS = 5_000;
const THROUGHPUT_WINDOW_SECONDS = 60;

const SEVERITY_DOT_CLASSES: Record<Severity, string> = {
  P0: "bg-severity-p0",
  P1: "bg-severity-p1",
  P2: "bg-severity-p2",
  P3: "bg-severity-p3",
};

function countBySeverity(incidents: readonly WorkItem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const incident of incidents) {
    counts[incident.severity] += 1;
  }
  return counts;
}

/**
 * Polls GET /api/v1/analytics/throughput over a trailing 60s window — the
 * only source for a genuine signal-ingestion rate (raw signals aren't 1:1
 * with incidents, thanks to debouncing, so the incident list itself can't
 * derive this). Severity counts, by contrast, come from the live incident
 * list already on screen (see countBySeverity above) rather than this
 * endpoint — that's the actual current active-incident breakdown, whereas
 * this endpoint's groupBy=severity counts incident *creation* events over a
 * time window, a different (and staler) thing.
 */
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
        if (cancelled) {
          return;
        }
        const total = response.points.reduce((sum, point) => sum + point.count, 0);
        setSignalsPerSecond(total / THROUGHPUT_WINDOW_SECONDS);
      } catch {
        // A header stat, not core dashboard data — a transient analytics
        // failure (or an aborted in-flight request) shouldn't disrupt the Live
        // Feed. Goes blank this cycle, tries again on the next poll.
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

export function IncidentHeaderStats({ incidents }: IncidentHeaderStatsProps): JSX.Element {
  const counts = countBySeverity(incidents);
  const throughput = useIngestionThroughput();

  return (
    <Card padding="sm" className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-center gap-4">
        {SEVERITIES.map((severity) => (
          <div key={severity} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT_CLASSES[severity]}`} aria-hidden="true" />
            <span className="text-sm text-ink-muted">{severity}</span>
            <span className="text-sm font-semibold tabular-nums text-ink">{counts[severity]}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-l border-border pl-6 text-sm">
        <span className="text-ink-muted">Ingestion</span>
        <span className="font-semibold tabular-nums text-ink">{throughput === null ? "—" : throughput.toFixed(1)}</span>
        <span className="text-ink-muted">signals/sec</span>
      </div>
    </Card>
  );
}

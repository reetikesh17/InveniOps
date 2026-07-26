import { useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import type { CallOptions } from "../../lib/api";
import type { ComponentHealth } from "../../types";
import { formatDuration } from "../incidents/formatDuration";
import { PanelShell } from "./PanelShell";
import { useAnalyticsResource } from "./useAnalyticsResource";
import type { TimeRange } from "./useTimeRange";

interface HealthRow {
  readonly componentId: string;
  readonly incidentCount: number;
  readonly openCount: number;
  readonly avgMttrMs: number | null;
  readonly recentSignalCount: number;
}

function toRow(health: ComponentHealth): HealthRow {
  const states = health.openWorkItemsByState;
  let incidentCount = 0;
  let openCount = 0;
  for (const [state, count] of Object.entries(states)) {
    incidentCount += count;
    if (state !== "CLOSED") {
      openCount += count;
    }
  }
  return {
    componentId: health.componentId,
    incidentCount,
    openCount,
    avgMttrMs: health.avgMttrMs,
    recentSignalCount: health.recentSignalCount,
  };
}

// Worst-first: most active incidents, then slowest to repair, then most
// churn overall. Pure sort of server-returned fields — no client aggregation.
function rankWorstFirst(a: HealthRow, b: HealthRow): number {
  if (b.openCount !== a.openCount) {
    return b.openCount - a.openCount;
  }
  const aMttr = a.avgMttrMs ?? -1;
  const bMttr = b.avgMttrMs ?? -1;
  if (bMttr !== aMttr) {
    return bMttr - aMttr;
  }
  return b.incidentCount - a.incidentCount;
}

function HeaderCell({ className, children }: { className: string; children: string }): JSX.Element {
  return <div className={`text-xs font-medium uppercase tracking-wide text-ink-faint ${className}`}>{children}</div>;
}

function FieldLabel({ children }: { children: string }): JSX.Element {
  return <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint sm:hidden">{children}</span>;
}

export interface ComponentHealthPanelProps {
  readonly range: TimeRange;
}

/**
 * Component health summary, ranked worst-first. There's no "all components"
 * endpoint, so the component set is taken from throughput's componentIds over
 * the range, then GET /analytics/components/:id is fanned out per component
 * (its avgMttr/open counts are windowed to the shared range). Components with
 * no signals in the range don't appear.
 */
export function ComponentHealthPanel({ range }: ComponentHealthPanelProps): JSX.Element {
  const { fromIso, toIso, intervalSeconds, rangeSeconds } = range;

  const fetcher = useCallback(
    async (opts: CallOptions): Promise<HealthRow[]> => {
      const throughput = await api.getThroughput({ from: fromIso, to: toIso, interval: intervalSeconds }, opts);
      const componentIds = [...new Set(throughput.points.map((point) => point.componentId))];
      const healths = await Promise.all(componentIds.map((id) => api.getComponentHealth(id, rangeSeconds, opts)));
      return healths.map(toRow).sort(rankWorstFirst);
    },
    [fromIso, toIso, intervalSeconds, rangeSeconds],
  );
  const { data, loading, error, refetch } = useAnalyticsResource(fetcher, [fromIso, toIso, intervalSeconds, rangeSeconds]);

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <PanelShell
      title="Component health"
      description="Ranked worst-first by open incidents, then slowest repair. Windowed to the selected range."
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      onRetry={refetch}
      emptyMessage="No component activity in this range."
    >
      <div role="table" aria-label="Component health" className="overflow-hidden rounded-lg border border-border">
        <div role="row" className="hidden gap-3 border-b border-border bg-surface-muted px-3 py-2 sm:flex">
          <HeaderCell className="w-8">#</HeaderCell>
          <HeaderCell className="flex-1">Component</HeaderCell>
          <HeaderCell className="w-24 text-right">Incidents</HeaderCell>
          <HeaderCell className="w-20 text-right">Open</HeaderCell>
          <HeaderCell className="w-24 text-right">Avg MTTR</HeaderCell>
          <HeaderCell className="w-24 text-right">Signals</HeaderCell>
        </div>
        <div role="rowgroup" className="divide-y divide-border">
          {rows.map((row, index) => (
            <div
              key={row.componentId}
              role="row"
              className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:gap-3"
            >
              <div role="cell" className="hidden w-8 shrink-0 tabular-nums text-ink-faint sm:block">
                {index + 1}
              </div>
              <div role="cell" className="min-w-0 flex-1 font-medium text-ink">
                <span className="mr-1 text-ink-faint sm:hidden">#{index + 1}</span>
                {row.componentId}
              </div>
              <div role="cell" className="shrink-0 tabular-nums text-ink sm:w-24 sm:text-right">
                <FieldLabel>Incidents</FieldLabel>
                {row.incidentCount}
              </div>
              <div role="cell" className="shrink-0 tabular-nums sm:w-20 sm:text-right">
                <FieldLabel>Open</FieldLabel>
                <span className={row.openCount > 0 ? "font-semibold text-severity-p0" : "text-ink"}>{row.openCount}</span>
              </div>
              <div role="cell" className="shrink-0 tabular-nums text-ink sm:w-24 sm:text-right">
                <FieldLabel>Avg MTTR</FieldLabel>
                {row.avgMttrMs === null ? "—" : formatDuration(Math.round(row.avgMttrMs / 1000))}
              </div>
              <div role="cell" className="shrink-0 tabular-nums text-ink-muted sm:w-24 sm:text-right">
                <FieldLabel>Signals</FieldLabel>
                {row.recentSignalCount}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

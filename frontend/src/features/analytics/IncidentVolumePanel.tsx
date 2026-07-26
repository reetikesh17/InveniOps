import { useCallback, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FOCUS_RING } from "../../components/Button";
import { api } from "../../lib/api";
import type { AnalyticsGroupBy } from "../../types";
import { ChartTooltipContent } from "./ChartTooltip";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_INK_MUTED,
  CHART_SURFACE,
  COMPONENT_TYPE_ORDER,
  SEVERITY_ORDER,
  colorForComponentType,
  colorForSeverity,
  formatBucketFull,
  makeTimeTickFormatter,
} from "./chartTheme";
import { CHART_HEIGHT, PanelShell } from "./PanelShell";
import { useAnalyticsResource } from "./useAnalyticsResource";
import type { TimeRange } from "./useTimeRange";

type PivotRow = Record<string, number | string> & { bucket: string };

function GroupByToggle({ value, onChange }: { value: AnalyticsGroupBy; onChange: (v: AnalyticsGroupBy) => void }): JSX.Element {
  const options: { key: AnalyticsGroupBy; label: string }[] = [
    { key: "componentType", label: "Component type" },
    { key: "severity", label: "Severity" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border-strong" role="group" aria-label="Group by">
      {options.map((option, index) => {
        const isSelected = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.key)}
            className={`px-2.5 py-1 text-xs font-medium ${index > 0 ? "border-l border-border-strong" : ""} ${
              isSelected ? "bg-ink text-white" : "bg-surface text-ink-muted hover:bg-surface-muted"
            } ${FOCUS_RING}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SeriesLegend({ series, colorFor }: { series: readonly string[]; colorFor: (v: string) => string }): JSX.Element {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((value) => (
        <li key={value} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: colorFor(value) }} aria-hidden="true" />
          {value}
        </li>
      ))}
    </ul>
  );
}

export interface IncidentVolumePanelProps {
  readonly range: TimeRange;
}

export function IncidentVolumePanel({ range }: IncidentVolumePanelProps): JSX.Element {
  const { fromIso, toIso, intervalSeconds, fromMs, toMs } = range;
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("componentType");

  const fetcher = useCallback(
    (opts: Parameters<typeof api.getIncidentCounts>[1]) =>
      api.getIncidentCounts({ from: fromIso, to: toIso, interval: intervalSeconds, groupBy }, opts),
    [fromIso, toIso, intervalSeconds, groupBy],
  );
  const { data, loading, error, refetch } = useAnalyticsResource(fetcher, [fromIso, toIso, intervalSeconds, groupBy]);

  const order = groupBy === "severity" ? SEVERITY_ORDER : COMPONENT_TYPE_ORDER;
  const colorFor = groupBy === "severity" ? colorForSeverity : colorForComponentType;

  // Pivot the server's long {bucket,value,count} rows into one row per bucket
  // with a column per series value (recharts' stacked-bar shape). No counts
  // are combined — the server already bucketed and grouped; this is a reshape.
  const { rows, activeSeries } = useMemo(() => {
    if (!data) {
      return { rows: [] as PivotRow[], activeSeries: [] as string[] };
    }
    const byBucket = new Map<string, PivotRow>();
    const present = new Set<string>();
    for (const point of data.points) {
      present.add(point.value);
      const row = byBucket.get(point.bucket) ?? ({ bucket: point.bucket } as PivotRow);
      row[point.value] = point.count;
      byBucket.set(point.bucket, row);
    }
    const sortedRows = [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    const series = order.filter((value) => present.has(value));
    return { rows: sortedRows, activeSeries: series };
  }, [data, order]);

  const tickFormatter = useMemo(() => makeTimeTickFormatter(fromMs, toMs), [fromMs, toMs]);

  return (
    <PanelShell
      title="Incident volume"
      description="Work items created per bucket, stacked by the selected dimension."
      controls={<GroupByToggle value={groupBy} onChange={setGroupBy} />}
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      onRetry={refetch}
    >
      <div className="flex flex-col gap-2">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={tickFormatter}
              stroke={CHART_AXIS}
              tick={{ fill: CHART_INK_MUTED, fontSize: 11 }}
              minTickGap={28}
            />
            <YAxis stroke={CHART_AXIS} tick={{ fill: CHART_INK_MUTED, fontSize: 11 }} width={36} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              content={
                <ChartTooltipContent labelFormatter={(label) => formatBucketFull(String(label))} valueFormatter={(v) => `${v}`} hideZero />
              }
            />
            {activeSeries.map((value, index) => (
              <Bar
                key={value}
                dataKey={value}
                name={value}
                stackId="incidents"
                fill={colorFor(value)}
                stroke={CHART_SURFACE}
                strokeWidth={1.5}
                radius={index === activeSeries.length - 1 ? [2, 2, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <SeriesLegend series={activeSeries} colorFor={colorFor} />
      </div>
    </PanelShell>
  );
}

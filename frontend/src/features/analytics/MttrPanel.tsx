import { useCallback, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FOCUS_RING } from "../../components/Button";
import { Select } from "../../components";
import { api } from "../../lib/api";
import type { AnalyticsGroupBy } from "../../types";
import { formatDuration } from "../incidents/formatDuration";
import { ChartTooltipContent } from "./ChartTooltip";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_INK_MUTED,
  COMPONENT_TYPE_ORDER,
  MTTR_AVG_COLOR,
  MTTR_ROLLING_COLOR,
  SEVERITY_ORDER,
  formatBucketFull,
  makeTimeTickFormatter,
} from "./chartTheme";
import { CHART_HEIGHT, PanelShell } from "./PanelShell";
import { useAnalyticsResource } from "./useAnalyticsResource";
import type { TimeRange } from "./useTimeRange";

function formatMttr(ms: number): string {
  return formatDuration(Math.round(ms / 1000));
}

function GroupByToggle({ value, onChange }: { value: AnalyticsGroupBy; onChange: (v: AnalyticsGroupBy) => void }): JSX.Element {
  const options: { key: AnalyticsGroupBy; label: string }[] = [
    { key: "severity", label: "Severity" },
    { key: "componentType", label: "Component type" },
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

function TwoLineLegend(): JSX.Element {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4" style={{ backgroundColor: MTTR_AVG_COLOR }} aria-hidden="true" />
        Bucket average
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-1 w-4 rounded-full" style={{ backgroundColor: MTTR_ROLLING_COLOR }} aria-hidden="true" />
        Rolling average (4 buckets)
      </li>
    </ul>
  );
}

export interface MttrPanelProps {
  readonly range: TimeRange;
}

export function MttrPanel({ range }: MttrPanelProps): JSX.Element {
  const { fromIso, toIso, intervalSeconds, fromMs, toMs } = range;
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("severity");
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  const fetcher = useCallback(
    (opts: Parameters<typeof api.getMttrTrend>[1]) =>
      api.getMttrTrend({ from: fromIso, to: toIso, interval: intervalSeconds, groupBy }, opts),
    [fromIso, toIso, intervalSeconds, groupBy],
  );
  const { data, loading, error, refetch } = useAnalyticsResource(fetcher, [fromIso, toIso, intervalSeconds, groupBy]);

  const order = groupBy === "severity" ? SEVERITY_ORDER : COMPONENT_TYPE_ORDER;

  // Which groups have any closed-incident MTTR data, in fixed palette order,
  // plus the default (most-sampled) group to lead with.
  const { presentValues, defaultValue } = useMemo(() => {
    const points = data?.points ?? [];
    const samplesByValue = new Map<string, number>();
    for (const point of points) {
      samplesByValue.set(point.value, (samplesByValue.get(point.value) ?? 0) + point.sampleCount);
    }
    // Cast to string[] so the downstream `.includes(selectedValue: string)` and
    // the <Select> options type cleanly — the fixed order is all we need here.
    const present = (order as readonly string[]).filter((value) => samplesByValue.has(value));
    let best: string | null = null;
    let bestSamples = -1;
    for (const [value, samples] of samplesByValue) {
      if (samples > bestSamples) {
        best = value;
        bestSamples = samples;
      }
    }
    return { presentValues: present, defaultValue: best };
  }, [data, order]);

  // Coerce the selection to something that exists in the current grouping —
  // so flipping severity↔componentType never leaves a dangling selection.
  const effectiveValue =
    selectedValue && presentValues.includes(selectedValue) ? selectedValue : defaultValue;

  const rows = useMemo(() => {
    if (!data || !effectiveValue) {
      return [];
    }
    return data.points
      .filter((point) => point.value === effectiveValue)
      .map((point) => ({ bucket: point.bucket, avg: point.avgMttrMs, rolling: point.rollingAvgMttrMs }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }, [data, effectiveValue]);

  const tickFormatter = useMemo(() => makeTimeTickFormatter(fromMs, toMs), [fromMs, toMs]);

  const valueSelector =
    presentValues.length > 0 ? (
      <div className="w-28">
        <Select
          aria-label="Series"
          value={effectiveValue ?? ""}
          onChange={(e) => setSelectedValue(e.target.value)}
          options={presentValues.map((value) => ({ value, label: value }))}
        />
      </div>
    ) : null;

  return (
    <PanelShell
      title="MTTR trend"
      description="Mean time to repair per bucket, with the server-computed rolling average overlaid."
      controls={
        <>
          <GroupByToggle value={groupBy} onChange={setGroupBy} />
          {valueSelector}
        </>
      }
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      onRetry={refetch}
      emptyMessage="No incidents were closed in this range, so there's no MTTR to trend."
    >
      <div className="flex flex-col gap-2">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={tickFormatter}
              stroke={CHART_AXIS}
              tick={{ fill: CHART_INK_MUTED, fontSize: 11 }}
              minTickGap={28}
            />
            <YAxis
              stroke={CHART_AXIS}
              tick={{ fill: CHART_INK_MUTED, fontSize: 11 }}
              width={48}
              tickFormatter={(value: number) => formatMttr(value)}
            />
            <Tooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatBucketFull(String(label))}
                  valueFormatter={(value) => formatMttr(Number(value))}
                  nameFor={(name) => (name === "avg" ? "Bucket average" : "Rolling average")}
                />
              }
            />
            <Line type="monotone" dataKey="avg" name="avg" stroke={MTTR_AVG_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="rolling"
              name="rolling"
              stroke={MTTR_ROLLING_COLOR}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        <TwoLineLegend />
      </div>
    </PanelShell>
  );
}

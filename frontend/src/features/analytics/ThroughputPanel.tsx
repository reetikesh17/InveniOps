import { useCallback, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../lib/api";
import { ChartTooltipContent } from "./ChartTooltip";
import { formatBucketFull, makeTimeTickFormatter, useChartColors } from "./chartTheme";
import { CHART_HEIGHT, PanelShell } from "./PanelShell";
import { useAnalyticsResource } from "./useAnalyticsResource";
import type { TimeRange } from "./useTimeRange";

export interface ThroughputPanelProps {
  readonly range: TimeRange;
}

export function ThroughputPanel({ range }: ThroughputPanelProps): JSX.Element {
  const { fromIso, toIso, intervalSeconds, fromMs, toMs } = range;
  const c = useChartColors();

  const fetcher = useCallback(
    (opts: Parameters<typeof api.getThroughput>[1]) =>
      api.getThroughput({ from: fromIso, to: toIso, interval: intervalSeconds }, opts),
    [fromIso, toIso, intervalSeconds],
  );
  const { data, loading, error, refetch } = useAnalyticsResource(fetcher, [
    fromIso,
    toIso,
    intervalSeconds,
  ]);

  // Total signals per bucket. The server already owns the time bucketing;
  // this only sums the per-(component,severity) rows that share a bucket into
  // one line — presentation reshaping, not re-aggregation.
  const rows = useMemo(() => {
    if (!data) {
      return [];
    }
    const totals = new Map<string, number>();
    for (const point of data.points) {
      totals.set(point.bucket, (totals.get(point.bucket) ?? 0) + point.count);
    }
    return [...totals.entries()]
      .map(([bucket, total]) => ({ bucket, total }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }, [data]);

  const tickFormatter = useMemo(() => makeTimeTickFormatter(fromMs, toMs), [fromMs, toMs]);

  return (
    <PanelShell
      title="Signal throughput"
      description="Signals ingested per bucket across the selected range."
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      onRetry={refetch}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={tickFormatter}
            stroke={c.axis}
            tick={{ fill: c.inkMuted, fontSize: 11 }}
            minTickGap={28}
          />
          <YAxis
            stroke={c.axis}
            tick={{ fill: c.inkMuted, fontSize: 11 }}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatBucketFull(String(label))}
                valueFormatter={(value) => `${value} signals`}
                nameFor={() => "Throughput"}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="total"
            name="Throughput"
            stroke={c.line}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </PanelShell>
  );
}

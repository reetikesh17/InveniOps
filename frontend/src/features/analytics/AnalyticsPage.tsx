import { ComponentHealthPanel } from "./ComponentHealthPanel";
import { IncidentVolumePanel } from "./IncidentVolumePanel";
import { MttrPanel } from "./MttrPanel";
import { SystemStatusPanel } from "./SystemStatusPanel";
import { ThroughputPanel } from "./ThroughputPanel";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { useTimeRange } from "./useTimeRange";

export function AnalyticsPage(): JSX.Element {
  const range = useTimeRange();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Analytics</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Timeseries from the aggregation sink and live system health. All bucketing is server-side; the shared range below
          is saved to the URL.
        </p>
      </div>

      <TimeRangeSelector range={range} />

      <SystemStatusPanel />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ThroughputPanel range={range} />
        <IncidentVolumePanel range={range} />
        <MttrPanel range={range} />
        <ComponentHealthPanel range={range} />
      </div>
    </div>
  );
}

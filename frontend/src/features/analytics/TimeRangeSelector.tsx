import { FOCUS_RING } from "../../components/Button";
import { EYEBROW_CLASSES } from "../../components/typography";
import { INTERVAL_OPTIONS, RANGE_OPTIONS, type TimeRange } from "./useTimeRange";

function Segmented<T extends string>({
  legend,
  options,
  selected,
  onSelect,
}: {
  legend: string;
  options: readonly { key: T; label: string }[];
  selected: T;
  onSelect: (key: T) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className={EYEBROW_CLASSES}>{legend}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border-strong" role="group" aria-label={legend}>
        {options.map((option, index) => {
          const isSelected = option.key === selected;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.key)}
              className={`px-2.5 py-1 text-xs font-medium ${index > 0 ? "border-l border-border-strong" : ""} ${
                isSelected ? "bg-ink text-surface-muted" : "bg-surface text-ink-muted hover:bg-surface-raised"
              } ${FOCUS_RING}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface TimeRangeSelectorProps {
  readonly range: TimeRange;
}

/** The one shared control driving every panel; its state lives in the URL (see useTimeRange). */
export function TimeRangeSelector({ range }: TimeRangeSelectorProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Segmented
        legend="Range"
        options={RANGE_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
        selected={range.rangeKey}
        onSelect={range.setRange}
      />
      <Segmented
        legend="Bucket"
        options={INTERVAL_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
        selected={range.intervalKey}
        onSelect={range.setInterval}
      />
      <button
        type="button"
        onClick={range.refresh}
        className={`rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted ${FOCUS_RING}`}
      >
        Refresh
      </button>
    </div>
  );
}

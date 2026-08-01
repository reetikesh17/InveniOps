// A single tooltip style shared by every chart, so the crosshair readout
// looks identical across throughput/volume/MTTR. Text wears ink tokens; the
// series colour appears only as a small swatch beside each row (identity via
// a mark, never coloured text — the dataviz rule).

export interface TooltipEntry {
  readonly name?: string | number;
  readonly value?: number | string;
  readonly color?: string;
  readonly dataKey?: string | number;
}

export interface ChartTooltipContentProps {
  // Injected by recharts when used as `content={<ChartTooltipContent .../>}`.
  readonly active?: boolean;
  readonly payload?: readonly TooltipEntry[];
  readonly label?: string | number;
  // Our config.
  readonly labelFormatter?: (label: string | number) => string;
  readonly valueFormatter?: (value: number | string) => string;
  readonly nameFor?: (name: string) => string;
  /** Hide rows whose value is zero/undefined — keeps a stacked-bar tooltip to the segments actually present. */
  readonly hideZero?: boolean;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (value) => String(value),
  nameFor,
  hideZero = false,
}: ChartTooltipContentProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const rows = payload.filter(
    (entry) => !hideZero || (entry.value !== undefined && entry.value !== 0),
  );
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs shadow-lg">
      {label !== undefined && (
        <p className="mb-1 font-mono text-mono-num font-medium tabular-nums text-ink">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {rows.map((entry, index) => {
          const rawName = String(entry.name ?? entry.dataKey ?? "");
          return (
            <li key={`${rawName}-${index}`} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
              <span className="text-ink-muted">{nameFor ? nameFor(rawName) : rawName}</span>
              <span className="ml-auto font-mono text-mono-num font-medium tabular-nums text-ink">
                {entry.value === undefined ? "—" : valueFormatter(entry.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

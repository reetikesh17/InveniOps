import { memo } from "react";
import { Link } from "react-router-dom";
import { RelativeTime, SeverityBadge, StateBadge } from "../../components";
import { FOCUS_RING } from "../../components/Button";
import type { WorkItem } from "../../types";
import { TimeInStateIndicator } from "./TimeInStateIndicator";

export interface IncidentRowProps {
  readonly incident: WorkItem;
  /** True for the ~2.5s window right after this incident first appeared — drives the entrance animation + highlight tint. */
  readonly isNew: boolean;
}

// Narrow-viewport-only micro labels so a stacked card stays self-describing
// without the wide-viewport column header row above it (which is hidden at
// that width) — see IncidentTable.tsx's header.
function FieldLabel({ children }: { children: string }): JSX.Element {
  return <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint sm:hidden">{children}</span>;
}

function IncidentRowInner({ incident, isNew }: IncidentRowProps): JSX.Element {
  return (
    <Link
      to={`/incidents/${encodeURIComponent(incident.id)}`}
      role="row"
      className={`flex flex-col gap-2 p-3 text-sm transition-colors duration-[2000ms] hover:bg-surface-muted sm:flex-row sm:items-center sm:gap-3 ${FOCUS_RING} ${
        isNew ? "animate-row-enter bg-amber-50" : "bg-surface"
      }`}
    >
      <div role="cell" className="flex w-24 shrink-0 items-center gap-2 sm:w-16">
        <SeverityBadge severity={incident.severity} />
      </div>

      <div role="cell" className="flex w-32 shrink-0 items-center gap-2 sm:w-28">
        <StateBadge state={incident.state} />
      </div>

      <div role="cell" className="w-full min-w-0 overflow-hidden sm:w-36 sm:shrink-0">
        <FieldLabel>Component</FieldLabel>
        <div className="truncate" title={`${incident.componentId} (${incident.componentType})`}>
          <span className="font-medium text-ink">{incident.componentId}</span>
          <span className="ml-1.5 text-xs text-ink-faint">{incident.componentType}</span>
        </div>
      </div>

      <div role="cell" className="w-full min-w-0 flex-1">
        <FieldLabel>Title</FieldLabel>
        <span className="block truncate text-ink" title={incident.title}>
          {incident.title}
        </span>
      </div>

      <div role="cell" className="w-full shrink-0 sm:w-20 sm:text-right">
        <FieldLabel>Signals</FieldLabel>
        <span className="tabular-nums text-ink">{incident.signalCount}</span>
      </div>

      <div role="cell" className="w-full shrink-0 sm:w-24">
        <FieldLabel>First seen</FieldLabel>
        <RelativeTime value={incident.firstSignalAt} className="text-ink-muted" />
      </div>

      <div role="cell" className="w-full shrink-0 sm:w-28">
        <FieldLabel>In state</FieldLabel>
        <TimeInStateIndicator since={incident.updatedAt} state={incident.state} />
      </div>
    </Link>
  );
}

// Memoized by VALUE, not reference: every SSE-triggered refetch replaces the
// whole list with freshly-parsed objects, so a reference-equality memo would
// never skip. Comparing the fields this row actually renders means a refresh
// that returns identical data re-renders zero rows — only rows whose data
// truly changed (a new state, a bumped signal count) repaint. That's what
// keeps a live update from cascading into a full-list re-render.
export const IncidentRow = memo(IncidentRowInner, (prev, next) => {
  if (prev.isNew !== next.isNew) {
    return false;
  }
  const a = prev.incident;
  const b = next.incident;
  return (
    a.id === b.id &&
    a.severity === b.severity &&
    a.state === b.state &&
    a.title === b.title &&
    a.componentId === b.componentId &&
    a.componentType === b.componentType &&
    a.signalCount === b.signalCount &&
    a.firstSignalAt === b.firstSignalAt &&
    a.updatedAt === b.updatedAt
  );
});

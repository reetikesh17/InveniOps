import { memo } from "react";
import { Link } from "react-router-dom";
import { AgeDot, MiddleTruncate, StateBadge } from "../../components";
import { FOCUS_RING } from "../../components/Button";
import { severityColor } from "../../components/severity";
import { EYEBROW_CLASSES, TITLE_CLASSES } from "../../components/typography";
import type { WorkItem } from "../../types";
import { TimeInStateIndicator } from "./TimeInStateIndicator";

export interface IncidentRowProps {
  readonly incident: WorkItem;
  /** True for the brief window right after this incident first appeared — drives the entrance lift. */
  readonly isNew: boolean;
}

// Narrow-viewport micro labels so a stacked card is self-describing without the
// wide-viewport column header (hidden at that width).
function FieldLabel({ children }: { children: string }): JSX.Element {
  return <span className={`mr-1 sm:hidden ${EYEBROW_CLASSES}`}>{children}</span>;
}

/**
 * A feed row. The severity SPINE is the signature: a 3px rail on the leading
 * edge (a continuous vertical ribbon down an abutting, sorted feed) plus an
 * age dot (how long) in the gutter. Everything else is instrument-grey — the
 * component id and counts in mono, the title in the body face, state in a
 * quiet outline. 28px tall on wide viewports; stacks to a card at 375px.
 */
function IncidentRowInner({ incident, isNew }: IncidentRowProps): JSX.Element {
  return (
    <Link
      to={`/incidents/${encodeURIComponent(incident.id)}`}
      role="row"
      // The rail is a left border so consecutive rows form one unbroken ribbon.
      style={{ borderLeftColor: severityColor(incident.severity) }}
      className={`flex items-stretch border-l-[3px] text-xs transition-colors hover:bg-surface-raised ${FOCUS_RING} ${
        isNew ? "animate-row-enter bg-surface-raised" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-t border-border px-2.5 py-2 sm:min-h-row sm:flex-row sm:items-center sm:gap-3 sm:py-0">
        {/* SEV — the spine's visible anchor: age dot + mono code (greyscale-safe) */}
        <div
          className="flex w-14 shrink-0 items-center gap-2"
          title={`Severity ${incident.severity}`}
        >
          <AgeDot severity={incident.severity} since={incident.updatedAt} state={incident.state} />
          <span className="font-mono text-mono-id font-medium tabular-nums text-ink">
            {incident.severity}
          </span>
        </div>

        {/* COMPONENT — machine id in mono. Middle-truncated (not CSS
            truncate): a tail-elided ellipsis can make RDBMS_1/RDBMS_11/
            RDBMS_110 render identically once the column runs out of room,
            hiding exactly the digit that disambiguates them. The full value
            is still one hover away via the cell's title. */}
        <div
          className="w-full min-w-0 overflow-hidden sm:w-48 sm:shrink-0"
          title={`${incident.componentId} · ${incident.componentType}`}
        >
          <FieldLabel>Component</FieldLabel>
          <div className="flex min-w-0 items-baseline gap-1.5">
            <MiddleTruncate
              text={incident.componentId}
              className="font-mono text-mono-id text-ink"
            />
            <span className="shrink-0 font-mono text-mono-micro text-ink-muted">
              {incident.componentType}
            </span>
          </div>
        </div>

        {/* TITLE — human prose in the body face */}
        <div className="w-full min-w-0 flex-1">
          <FieldLabel>Title</FieldLabel>
          <span className={`block truncate ${TITLE_CLASSES}`} title={incident.title}>
            {incident.title}
          </span>
        </div>

        {/* SIG — count: tabular figures, right-aligned, the one genuinely
            numeric column in this row. */}
        <div className="w-full shrink-0 sm:w-14 sm:text-right">
          <FieldLabel>Signals</FieldLabel>
          <span className="font-mono text-mono-num tabular-nums text-ink-muted">
            {incident.signalCount}
          </span>
        </div>

        {/* IN STATE — how long, brightness-escalating */}
        <div className="w-full shrink-0 sm:w-24">
          <FieldLabel>In state</FieldLabel>
          <TimeInStateIndicator since={incident.updatedAt} state={incident.state} />
        </div>

        {/* STATE — quiet, no colour */}
        <div className="w-full shrink-0 sm:w-28">
          <FieldLabel>State</FieldLabel>
          <StateBadge state={incident.state} />
        </div>
      </div>
    </Link>
  );
}

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

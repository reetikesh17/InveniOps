import type { ReactNode } from "react";
import { RelativeTime, SeverityBadge, StateBadge } from "../../components";
import { EYEBROW_CLASSES } from "../../components/typography";
import type { IncidentDetail } from "../../types";
import { formatDuration } from "./formatDuration";
import { TimeInStateIndicator } from "./TimeInStateIndicator";

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={EYEBROW_CLASSES}>{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export interface DetailHeaderProps {
  readonly detail: IncidentDetail;
}

export function DetailHeader({ detail }: DetailHeaderProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SeverityBadge severity={detail.severity} />
        <StateBadge state={detail.state} />
        <h1 className="text-xl font-semibold text-ink">{detail.title}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Component">
          <span className="font-mono text-mono-id text-ink">{detail.componentId}</span>
          <span className="ml-1 font-mono text-mono-micro text-ink-muted">
            ({detail.componentType})
          </span>
        </Field>
        <Field label="First seen">
          <RelativeTime
            value={detail.firstSignalAt}
            className="font-mono text-mono-num tabular-nums text-ink"
          />
        </Field>
        <Field label="Time in state">
          <TimeInStateIndicator since={detail.updatedAt} state={detail.state} />
        </Field>
        <Field label="Signal count">
          <span className="font-mono text-mono-num tabular-nums text-ink">
            {detail.signalCount}
          </span>
        </Field>
        {detail.rca && (
          <Field label="MTTR">
            <span className="font-mono text-mono-num tabular-nums text-ink">
              {formatDuration(detail.rca.mttrSeconds)}
            </span>
          </Field>
        )}
      </div>
    </div>
  );
}

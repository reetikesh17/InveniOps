import { RelativeTime } from "../../components";
import { EYEBROW_CLASSES } from "../../components/typography";
import type { RcaRecord } from "../../types";
import { formatDuration } from "./formatDuration";

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={EYEBROW_CLASSES}>{label}</span>
      <p className="whitespace-pre-wrap font-body text-prose text-ink">{value}</p>
    </div>
  );
}

export interface RcaReadOnlyProps {
  readonly rca: RcaRecord;
}

/** The submitted RCA, read-only — this incident is CLOSED, so nothing here is editable. */
export function RcaReadOnly({ rca }: RcaReadOnlyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Incident start" value={new Date(rca.incidentStartTime).toLocaleString()} />
        <Field label="Incident end" value={new Date(rca.incidentEndTime).toLocaleString()} />
        <Field label="Root cause category" value={rca.rootCauseCategory.replaceAll("_", " ")} />
        <Field label="MTTR" value={formatDuration(rca.mttrSeconds)} />
      </div>
      <Field label="Root cause description" value={rca.rootCauseDescription} />
      <Field label="Fix applied" value={rca.fixApplied} />
      <Field label="Prevention steps" value={rca.preventionSteps} />
      <p className="text-xs text-ink-muted">
        Submitted <RelativeTime value={rca.submittedAt} className="font-mono text-mono-micro tabular-nums" />
      </p>
    </div>
  );
}

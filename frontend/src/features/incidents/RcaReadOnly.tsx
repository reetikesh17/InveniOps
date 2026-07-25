import { RelativeTime } from "../../components";
import type { RcaRecord } from "../../types";
import { formatDuration } from "./formatDuration";

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <p className="whitespace-pre-wrap text-sm text-ink">{value}</p>
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
      <p className="text-xs text-ink-faint">
        Submitted <RelativeTime value={rca.submittedAt} />
      </p>
    </div>
  );
}

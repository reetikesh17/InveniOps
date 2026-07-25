import { useState, type FormEvent } from "react";
import { Button, DateTimeInput, Select, TextArea } from "../../components";
import { api, ApiRequestError } from "../../lib/api";
import { ROOT_CAUSE_CATEGORIES, type RootCauseCategory } from "../../types";

const CATEGORY_OPTIONS = ROOT_CAUSE_CATEGORIES.map((category) => ({
  value: category,
  label: category.replaceAll("_", " "),
}));

function formatDatetimeLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// datetime-local has minute precision. The backend requires
// incidentStartTime >= firstSignalAt (millisecond-precise), so flooring
// firstSignalAt to the minute would default to a value *before* it and get
// rejected — round UP to the next minute instead, so the prefilled default
// is always itself valid.
function defaultStartValue(firstSignalAtIso: string): string {
  const date = new Date(firstSignalAtIso);
  if (date.getSeconds() > 0 || date.getMilliseconds() > 0) {
    date.setMinutes(date.getMinutes() + 1);
  }
  date.setSeconds(0, 0);
  return formatDatetimeLocal(date);
}

export interface RcaFormProps {
  readonly incidentId: string;
  readonly firstSignalAt: string;
  readonly actor: string;
  readonly onSubmitted: () => void;
  readonly onConflict: (message: string) => void;
}

/** Incident Start/End, Root Cause Category, Fix Applied, Prevention Steps — the assignment's RCA Form, embedded directly in the Incident Detail page (see IncidentDetailPage.tsx) rather than as a separate route. */
export function RcaForm({ incidentId, firstSignalAt, actor, onSubmitted, onConflict }: RcaFormProps): JSX.Element {
  const [incidentStartTime, setIncidentStartTime] = useState(() => defaultStartValue(firstSignalAt));
  const [incidentEndTime, setIncidentEndTime] = useState(() => formatDatetimeLocal(new Date()));
  const [rootCauseCategory, setRootCauseCategory] = useState("");
  const [rootCauseDescription, setRootCauseDescription] = useState("");
  const [fixApplied, setFixApplied] = useState("");
  const [preventionSteps, setPreventionSteps] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    try {
      await api.submitRca(incidentId, {
        actor,
        incidentStartTime: new Date(incidentStartTime).toISOString(),
        incidentEndTime: new Date(incidentEndTime).toISOString(),
        rootCauseCategory: rootCauseCategory as RootCauseCategory,
        rootCauseDescription,
        fixApplied,
        preventionSteps,
      });
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiRequestError && err.info.kind === "invalid_rca") {
        setFieldErrors(Object.fromEntries(err.info.fieldErrors.map((fieldError) => [fieldError.field, fieldError.message])));
      } else if (err instanceof ApiRequestError && err.info.kind === "conflict") {
        // "invalid_state" here means this incident is no longer RESOLVED (someone
        // else transitioned or closed it) — the same "state moved concurrently"
        // case the state-machine control handles, routed through the same banner.
        onConflict("This incident's state changed before the RCA could be submitted — showing the latest state.");
      } else if (err instanceof ApiRequestError) {
        setGeneralError(err.info.message);
      } else {
        setGeneralError("Something went wrong submitting the RCA.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateTimeInput
          label="Incident start time"
          value={incidentStartTime}
          onChange={(e) => setIncidentStartTime(e.target.value)}
          error={fieldErrors["incidentStartTime"]}
          required
        />
        <DateTimeInput
          label="Incident end time"
          value={incidentEndTime}
          onChange={(e) => setIncidentEndTime(e.target.value)}
          error={fieldErrors["incidentEndTime"]}
          required
        />
      </div>

      <Select
        label="Root cause category"
        placeholder="Select a category…"
        value={rootCauseCategory}
        onChange={(e) => setRootCauseCategory(e.target.value)}
        options={CATEGORY_OPTIONS}
        error={fieldErrors["rootCauseCategory"]}
        required
      />

      <TextArea
        label="Root cause description"
        value={rootCauseDescription}
        onChange={(e) => setRootCauseDescription(e.target.value)}
        error={fieldErrors["rootCauseDescription"]}
        required
      />

      <TextArea
        label="Fix applied"
        value={fixApplied}
        onChange={(e) => setFixApplied(e.target.value)}
        error={fieldErrors["fixApplied"]}
        required
      />

      <TextArea
        label="Prevention steps"
        value={preventionSteps}
        onChange={(e) => setPreventionSteps(e.target.value)}
        error={fieldErrors["preventionSteps"]}
        required
      />

      {generalError && <p className="text-sm text-red-700">{generalError}</p>}

      <div>
        <Button type="submit" variant="primary" loading={submitting}>
          Submit RCA and close incident
        </Button>
      </div>
    </form>
  );
}

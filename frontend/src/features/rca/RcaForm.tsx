import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Card, DateTimeInput, Select, TextArea } from "../../components";
import { api, ApiRequestError } from "../../lib/api";
import { ROOT_CAUSE_CATEGORIES, type RootCauseCategory } from "../../types";
import { formatDuration } from "../incidents/formatDuration";
import { clearDraft, loadDraft, saveDraft } from "./rcaDraft";
import { useUnsavedChangesWarning } from "./useUnsavedChangesWarning";
import {
  MIN_TEXT_FIELD_LENGTH,
  firstInvalidField,
  hasErrors,
  validateRcaForm,
  type RcaFieldErrors,
  type RcaFieldName,
  type RcaFormValues,
} from "./rcaValidation";

const CATEGORY_OPTIONS = ROOT_CAUSE_CATEGORIES.map((category) => ({
  value: category,
  label: category.replaceAll("_", " "),
}));

// One stable DOM id per field so a failed submit can focus the first invalid
// control (the wrapper components render the real control internally, so we
// address it by id rather than juggling refs through them).
function domId(field: RcaFieldName): string {
  return `rca-${field}`;
}

function formatDatetimeLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// datetime-local is minute-precise; the backend requires start >= firstSignalAt
// (millisecond-precise), so flooring firstSignalAt to the minute would prefill
// a value *before* it and fail validation. Round UP so the default is itself valid.
function defaultStartValue(firstSignalAtIso: string): string {
  const date = new Date(firstSignalAtIso);
  if (date.getSeconds() > 0 || date.getMilliseconds() > 0) {
    date.setMinutes(date.getMinutes() + 1);
  }
  date.setSeconds(0, 0);
  return formatDatetimeLocal(date);
}

function buildDefaults(firstSignalAtIso: string): RcaFormValues {
  return {
    incidentStartTime: defaultStartValue(firstSignalAtIso),
    incidentEndTime: formatDatetimeLocal(new Date()),
    rootCauseCategory: "",
    rootCauseDescription: "",
    fixApplied: "",
    preventionSteps: "",
  };
}

function CharacterCounter({ value }: { value: string }): JSX.Element {
  const length = value.trim().length;
  const met = length >= MIN_TEXT_FIELD_LENGTH;
  return (
    <span className={met ? "text-emerald-600" : "text-ink-faint"}>
      {length}/{MIN_TEXT_FIELD_LENGTH}
      {met ? " ✓" : " min"}
    </span>
  );
}

function UnsavedChangesDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="rca-leave-title" className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-lg">
        <h2 id="rca-leave-title" className="text-base font-semibold text-ink">
          Discard this RCA?
        </h2>
        <p className="mt-1 text-sm text-ink-muted">You have an unsaved root cause analysis. Leaving now will keep your draft in this session, but the incident won’t be closed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onStay}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onLeave}>
            Leave anyway
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface RcaFormProps {
  readonly incidentId: string;
  readonly firstSignalAt: string;
  readonly actor: string;
  readonly onSubmitted: () => void;
  readonly onConflict: (message: string) => void;
}

/**
 * The workflow's terminal step: the full RCA contract (both timestamps,
 * category, and all three narrative fields), client-validated as a mirror of
 * the backend domain rules — but the backend stays the gate, so a 422 maps
 * straight back onto the offending fields. Embedded on the Incident Detail
 * page for a RESOLVED incident (see IncidentDetailPage.tsx); on success the
 * parent refetches and the page re-renders as the read-only CLOSED view.
 */
export function RcaForm({ incidentId, firstSignalAt, actor, onSubmitted, onConflict }: RcaFormProps): JSX.Element {
  const firstSignalDate = useMemo(() => new Date(firstSignalAt), [firstSignalAt]);
  const defaultsRef = useRef<RcaFormValues>(buildDefaults(firstSignalAt));

  const [values, setValues] = useState<RcaFormValues>(() => {
    const draft = loadDraft(incidentId);
    return draft ? { ...defaultsRef.current, ...draft } : defaultsRef.current;
  });
  const [touched, setTouched] = useState<Partial<Record<RcaFieldName, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<RcaFieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Ticks so the MTTR preview and the "not in the future" bounds track real
  // time while the operator writes, without needing a manual refresh.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const clientErrors = validateRcaForm(values, { firstSignalAt: firstSignalDate, now });

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(defaultsRef.current),
    [values],
  );
  const blocker = useUnsavedChangesWarning(isDirty && !submitted);

  // Persist every keystroke to the session draft (until submitted, after
  // which the draft is intentionally cleared and must not be rewritten).
  useEffect(() => {
    if (submitted) {
      return;
    }
    saveDraft(incidentId, values);
  }, [incidentId, values, submitted]);

  function setField(field: RcaFieldName, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    // A fresh keystroke supersedes the server's last verdict for that field.
    setServerErrors((current) => {
      if (current[field] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function markTouched(field: RcaFieldName): void {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  // Server verdict wins when present; otherwise show the client error only
  // once the field has been interacted with (or a submit was attempted), so a
  // pristine form isn't blanketed in "required" messages.
  function errorFor(field: RcaFieldName): string | undefined {
    if (serverErrors[field]) {
      return serverErrors[field];
    }
    if (submitAttempted || touched[field]) {
      return clientErrors[field];
    }
    return undefined;
  }

  function focusFirstInvalid(errors: RcaFieldErrors): void {
    const field = firstInvalidField(errors);
    if (field) {
      document.getElementById(domId(field))?.focus();
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return; // Guard against a double submit racing the disabled state.
    }
    setSubmitAttempted(true);
    setGeneralError(null);

    // Client validation is a convenience gate only — skip a request that's
    // certain to 422, and focus the operator on the first thing to fix.
    const localErrors = validateRcaForm(values, { firstSignalAt: firstSignalDate, now: new Date() });
    if (hasErrors(localErrors)) {
      focusFirstInvalid(localErrors);
      return;
    }

    setSubmitting(true);
    setServerErrors({});
    try {
      await api.submitRca(incidentId, {
        actor,
        incidentStartTime: new Date(values.incidentStartTime).toISOString(),
        incidentEndTime: new Date(values.incidentEndTime).toISOString(),
        rootCauseCategory: values.rootCauseCategory as RootCauseCategory,
        rootCauseDescription: values.rootCauseDescription,
        fixApplied: values.fixApplied,
        preventionSteps: values.preventionSteps,
      });
      // Mark submitted before clearing so the draft-save effect doesn't rewrite it.
      setSubmitted(true);
      clearDraft(incidentId);
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiRequestError && err.info.kind === "invalid_rca") {
        // The backend is authoritative — its field errors override whatever
        // the client thought, mapped onto the same fields and focused.
        const mapped: RcaFieldErrors = {};
        for (const fieldError of err.info.fieldErrors) {
          mapped[fieldError.field as RcaFieldName] = fieldError.message;
        }
        setServerErrors(mapped);
        focusFirstInvalid(mapped);
      } else if (err instanceof ApiRequestError && err.info.kind === "conflict") {
        onConflict("This incident’s state changed before the RCA could be submitted — showing the latest state.");
      } else if (err instanceof ApiRequestError) {
        setGeneralError(err.info.message);
      } else {
        setGeneralError("Something went wrong submitting the RCA.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const recordedSeconds = Math.round((now.getTime() - firstSignalDate.getTime()) / 1000);
  const enteredStart = new Date(values.incidentStartTime);
  const enteredEnd = new Date(values.incidentEndTime);
  const windowValid =
    !Number.isNaN(enteredStart.getTime()) &&
    !Number.isNaN(enteredEnd.getTime()) &&
    enteredEnd.getTime() > enteredStart.getTime();
  const windowSeconds = windowValid ? Math.round((enteredEnd.getTime() - enteredStart.getTime()) / 1000) : null;

  const nowLocal = formatDatetimeLocal(now);

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
      {blocker.state === "blocked" && (
        <UnsavedChangesDialog onStay={() => blocker.reset()} onLeave={() => blocker.proceed()} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateTimeInput
          id={domId("incidentStartTime")}
          label="Incident start time"
          value={values.incidentStartTime}
          min={defaultStartValue(firstSignalAt)}
          max={nowLocal}
          onChange={(e) => setField("incidentStartTime", e.target.value)}
          onBlur={() => markTouched("incidentStartTime")}
          error={errorFor("incidentStartTime")}
        />
        <DateTimeInput
          id={domId("incidentEndTime")}
          label="Incident end time"
          value={values.incidentEndTime}
          min={values.incidentStartTime}
          max={nowLocal}
          onChange={(e) => setField("incidentEndTime", e.target.value)}
          onBlur={() => markTouched("incidentEndTime")}
          error={errorFor("incidentEndTime")}
        />
      </div>

      <Card padding="sm" className="bg-surface-muted">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">MTTR to be recorded</span>
            <span className="text-lg font-semibold tabular-nums text-ink" aria-live="polite">
              {recordedSeconds < 0 ? "—" : formatDuration(recordedSeconds)}
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            First signal → submission. Your entered incident window:{" "}
            <span className="tabular-nums text-ink">{windowSeconds === null ? "—" : formatDuration(windowSeconds)}</span>
          </p>
        </div>
      </Card>

      <Select
        id={domId("rootCauseCategory")}
        label="Root cause category"
        placeholder="Select a category…"
        value={values.rootCauseCategory}
        onChange={(e) => setField("rootCauseCategory", e.target.value)}
        onBlur={() => markTouched("rootCauseCategory")}
        options={CATEGORY_OPTIONS}
        error={errorFor("rootCauseCategory")}
      />

      <TextArea
        id={domId("rootCauseDescription")}
        label="Root cause description"
        value={values.rootCauseDescription}
        onChange={(e) => setField("rootCauseDescription", e.target.value)}
        onBlur={() => markTouched("rootCauseDescription")}
        error={errorFor("rootCauseDescription")}
        hint={<CharacterCounter value={values.rootCauseDescription} />}
      />

      <TextArea
        id={domId("fixApplied")}
        label="Fix applied"
        value={values.fixApplied}
        onChange={(e) => setField("fixApplied", e.target.value)}
        onBlur={() => markTouched("fixApplied")}
        error={errorFor("fixApplied")}
        hint={<CharacterCounter value={values.fixApplied} />}
      />

      <TextArea
        id={domId("preventionSteps")}
        label="Prevention steps"
        value={values.preventionSteps}
        onChange={(e) => setField("preventionSteps", e.target.value)}
        onBlur={() => markTouched("preventionSteps")}
        error={errorFor("preventionSteps")}
        hint={<CharacterCounter value={values.preventionSteps} />}
      />

      {generalError && (
        <p role="alert" className="text-sm text-red-700">
          {generalError}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" loading={submitting}>
          {submitting ? "Submitting…" : "Submit RCA and close incident"}
        </Button>
      </div>
    </form>
  );
}

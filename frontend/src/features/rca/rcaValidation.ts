import { ROOT_CAUSE_CATEGORIES } from "../../types";

// Mirrors backend/src/domain/rca/validateRca.ts's MIN_TEXT_FIELD_LENGTH.
// Client-side validation is a convenience only — the backend domain layer
// stays authoritative (see validateRca.ts / closeGuard.ts) — but it must not
// disagree with the backend about what's valid, so every rule here is a
// deliberate mirror of a rule there, keyed to the same field names the 422
// response uses.
export const MIN_TEXT_FIELD_LENGTH = 10;

export type RcaFieldName =
  | "incidentStartTime"
  | "incidentEndTime"
  | "rootCauseCategory"
  | "rootCauseDescription"
  | "fixApplied"
  | "preventionSteps";

// The order the form lays fields out in — used to focus the first invalid
// field on a failed submit (top-to-bottom, matching reading order).
export const RCA_FIELD_ORDER: readonly RcaFieldName[] = [
  "incidentStartTime",
  "incidentEndTime",
  "rootCauseCategory",
  "rootCauseDescription",
  "fixApplied",
  "preventionSteps",
];

export const RCA_FIELD_LABELS: Record<RcaFieldName, string> = {
  incidentStartTime: "Start time",
  incidentEndTime: "End time",
  rootCauseCategory: "Root cause category",
  rootCauseDescription: "Root cause description",
  fixApplied: "Fix applied",
  preventionSteps: "Prevention steps",
};

const TEXT_FIELDS: readonly Extract<
  RcaFieldName,
  "rootCauseDescription" | "fixApplied" | "preventionSteps"
>[] = ["rootCauseDescription", "fixApplied", "preventionSteps"];

export interface RcaFormValues {
  /** All datetime fields are `datetime-local` strings ("YYYY-MM-DDTHH:mm"), empty when unset. */
  readonly incidentStartTime: string;
  readonly incidentEndTime: string;
  readonly rootCauseCategory: string;
  readonly rootCauseDescription: string;
  readonly fixApplied: string;
  readonly preventionSteps: string;
}

export interface RcaValidationContext {
  readonly firstSignalAt: Date;
  readonly now: Date;
}

export type RcaFieldErrors = Partial<Record<RcaFieldName, string>>;

/** null for an empty or unparseable datetime-local string — the same "missing or invalid" bucket the backend collapses these into. */
function parseLocal(value: string): Date | null {
  if (value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isKnownCategory(value: string): boolean {
  return (ROOT_CAUSE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Mirrors validateRca on the backend rule-for-rule: every field required and
 * non-empty; text fields at least MIN_TEXT_FIELD_LENGTH characters after
 * trimming; category a known enum member; end strictly after start; start not
 * before firstSignalAt; neither timestamp in the future. Relational checks
 * only run once the fields they compare are individually valid, so a missing
 * start never also produces a confusing "end before start" error — same as
 * the backend. Returns at most one message per field (the first rule that
 * fails), which is what the inline UI displays.
 */
export function validateRcaForm(
  values: RcaFormValues,
  context: RcaValidationContext,
): RcaFieldErrors {
  const errors: RcaFieldErrors = {};

  const start = parseLocal(values.incidentStartTime);
  const end = parseLocal(values.incidentEndTime);

  if (!start) {
    errors.incidentStartTime = "Start time is required.";
  }
  if (!end) {
    errors.incidentEndTime = "End time is required.";
  }

  const category = values.rootCauseCategory.trim();
  if (category === "") {
    errors.rootCauseCategory = "Select a root cause category.";
  } else if (!isKnownCategory(category)) {
    errors.rootCauseCategory = `Category must be one of: ${ROOT_CAUSE_CATEGORIES.join(", ")}.`;
  }

  for (const field of TEXT_FIELDS) {
    const trimmed = values[field].trim();
    if (trimmed.length === 0) {
      errors[field] = `${RCA_FIELD_LABELS[field]} is required.`;
    } else if (trimmed.length < MIN_TEXT_FIELD_LENGTH) {
      errors[field] =
        `${RCA_FIELD_LABELS[field]} must be at least ${MIN_TEXT_FIELD_LENGTH} characters.`;
    }
  }

  // Relational checks — guarded on the compared fields already being valid,
  // and only set if that field doesn't already carry an error, so the first
  // failing rule per field wins (matching the inline one-message-per-field UI).
  if (start && end && !errors.incidentEndTime && end.getTime() <= start.getTime()) {
    errors.incidentEndTime = "End time must be after the start time.";
  }

  if (start && !errors.incidentStartTime && start.getTime() < context.firstSignalAt.getTime()) {
    errors.incidentStartTime = "Start time can’t be before the incident’s first signal.";
  }

  if (start && !errors.incidentStartTime && start.getTime() > context.now.getTime()) {
    errors.incidentStartTime = "Start time can’t be in the future.";
  }

  if (end && !errors.incidentEndTime && end.getTime() > context.now.getTime()) {
    errors.incidentEndTime = "End time can’t be in the future.";
  }

  return errors;
}

/** First field (in form order) carrying an error, or null when there are none — drives focus-on-failed-submit. */
export function firstInvalidField(errors: RcaFieldErrors): RcaFieldName | null {
  return RCA_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

export function hasErrors(errors: RcaFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

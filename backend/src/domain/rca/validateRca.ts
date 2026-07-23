import {
  ROOT_CAUSE_CATEGORIES,
  type RcaField,
  type RcaFieldError,
  type RcaRecord,
  type RcaValidationContext,
  type RcaValidationResult,
  type RootCauseCategory,
} from "./types.js";

// Rules out placeholder/lazy answers ("n/a", "fixed", "done", "TBD") and
// single words, while still allowing terse-but-real answers ("Restarted
// pod", "Increased timeout"). Picked empirically: short enough not to
// reject a legitimately concise RCA, long enough that no one-or-two-word
// placeholder clears it.
export const MIN_TEXT_FIELD_LENGTH = 10;

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isRootCauseCategory(value: string): value is RootCauseCategory {
  return (ROOT_CAUSE_CATEGORIES as readonly string[]).includes(value);
}

// `value` is typed unknown rather than the field's declared string type —
// this function is also relied on at the boundary where an untrusted
// `unknown` transition payload is validated (see ../rca/closeGuard.ts),
// so it must not assume the runtime type matches the declared one.
function validateTextField(value: unknown, field: RcaField): RcaFieldError[] {
  if (value === null || value === undefined || typeof value !== "string") {
    return [{ field, message: `${field} is required.` }];
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [{ field, message: `${field} is required.` }];
  }
  if (trimmed.length < MIN_TEXT_FIELD_LENGTH) {
    return [
      {
        field,
        message: `${field} must be at least ${MIN_TEXT_FIELD_LENGTH} characters, excluding leading/trailing whitespace.`,
      },
    ];
  }
  return [];
}

export function validateRca(rca: RcaRecord, context: RcaValidationContext): RcaValidationResult {
  const errors: RcaFieldError[] = [];
  const {
    incidentStartTime,
    incidentEndTime,
    rootCauseCategory,
    rootCauseDescription,
    fixApplied,
    preventionSteps,
  } = rca;

  const startValid = isValidDate(incidentStartTime);
  const endValid = isValidDate(incidentEndTime);

  if (!startValid) {
    errors.push({ field: "incidentStartTime", message: "incidentStartTime is required." });
  }
  if (!endValid) {
    errors.push({ field: "incidentEndTime", message: "incidentEndTime is required." });
  }

  if (
    rootCauseCategory === null ||
    rootCauseCategory === undefined ||
    typeof rootCauseCategory !== "string" ||
    rootCauseCategory.trim().length === 0
  ) {
    errors.push({ field: "rootCauseCategory", message: "rootCauseCategory is required." });
  } else if (!isRootCauseCategory(rootCauseCategory)) {
    errors.push({
      field: "rootCauseCategory",
      message: `rootCauseCategory must be one of: ${ROOT_CAUSE_CATEGORIES.join(", ")}.`,
    });
  }

  errors.push(...validateTextField(rootCauseDescription, "rootCauseDescription"));
  errors.push(...validateTextField(fixApplied, "fixApplied"));
  errors.push(...validateTextField(preventionSteps, "preventionSteps"));

  // Relational checks only run once the fields they compare are themselves
  // individually valid — otherwise they'd produce confusing secondary
  // errors on top of the "required" error already reported above.
  if (startValid && endValid && incidentEndTime.getTime() <= incidentStartTime.getTime()) {
    errors.push({
      field: "incidentEndTime",
      message: "incidentEndTime must be strictly after incidentStartTime.",
    });
  }

  if (startValid && incidentStartTime.getTime() < context.firstSignalAt.getTime()) {
    errors.push({
      field: "incidentStartTime",
      message: "incidentStartTime cannot precede the work item's first signal timestamp.",
    });
  }

  if (startValid && incidentStartTime.getTime() > context.now.getTime()) {
    errors.push({ field: "incidentStartTime", message: "incidentStartTime cannot be in the future." });
  }

  if (endValid && incidentEndTime.getTime() > context.now.getTime()) {
    errors.push({ field: "incidentEndTime", message: "incidentEndTime cannot be in the future." });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

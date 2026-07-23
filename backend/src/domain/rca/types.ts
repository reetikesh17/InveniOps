export const ROOT_CAUSE_CATEGORIES = [
  "CODE_DEFECT",
  "INFRASTRUCTURE_FAILURE",
  "CONFIGURATION_ERROR",
  "CAPACITY_EXHAUSTION",
  "EXTERNAL_DEPENDENCY",
  "NETWORK",
  "HUMAN_ERROR",
  "UNKNOWN",
] as const;

// Mirrors the RootCauseCategory enum proposed for prisma/schema.prisma
// (still pending approval — see docs/decisions/0001-postgres-for-source-of-truth.md).
// Defined here as the source of truth until that schema is confirmed; copy
// these values over verbatim when it is.
export type RootCauseCategory = (typeof ROOT_CAUSE_CATEGORIES)[number];

// Fields typed loosely (nullable/undefined, category as a plain string) on
// purpose — this is the shape of a *candidate* submission being validated,
// not a record already known to be well-formed.
export interface RcaRecord {
  readonly incidentStartTime: Date | null | undefined;
  readonly incidentEndTime: Date | null | undefined;
  readonly rootCauseCategory: string | null | undefined;
  readonly rootCauseDescription: string | null | undefined;
  readonly fixApplied: string | null | undefined;
  readonly preventionSteps: string | null | undefined;
}

export type RcaField =
  | "incidentStartTime"
  | "incidentEndTime"
  | "rootCauseCategory"
  | "rootCauseDescription"
  | "fixApplied"
  | "preventionSteps";

export interface RcaFieldError {
  readonly field: RcaField;
  readonly message: string;
}

export type RcaValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly RcaFieldError[] };

export interface RcaValidationContext {
  readonly firstSignalAt: Date;
  readonly now: Date;
}

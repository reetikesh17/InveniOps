import { FOCUS_RING } from "./Button";

/** Shared by Input/Select/TextArea/DateTimeInput so every form control has identical border/focus/error/disabled treatment. */
export function fieldClasses(hasError: boolean, extra = ""): string {
  const border = hasError ? "border-red-500" : "border-border-strong";
  return `w-full rounded-md border ${border} bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-faint ${FOCUS_RING} ${extra}`;
}

export const FIELD_LABEL_CLASSES = "text-xs font-medium text-ink-muted";
export const FIELD_ERROR_CLASSES = "text-xs text-red-600";

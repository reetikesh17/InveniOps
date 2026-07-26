import { FOCUS_RING } from "./Button";
import { EYEBROW_CLASSES } from "./typography";

// Font-size is deliberately NOT baked in here — different fields need
// different rungs (TextArea's free-text is `prose`, everything else is
// Tailwind's default `text-sm`), and two font-size utilities on one element
// would race on Tailwind's generated-CSS order. Each caller passes its own
// size via `extra`; see Input/Select/DateTimeInput vs TextArea below.
/** Shared by Input/Select/TextArea/DateTimeInput so every form control has identical border/focus/error/disabled treatment. */
export function fieldClasses(hasError: boolean, extra = ""): string {
  const border = hasError ? "border-severity-p0" : "border-border-strong";
  // placeholder is ink-muted, not ink-faint — it's the only content in an
  // empty field, so it needs real AA text contrast; ink-faint (~2.7-3:1)
  // fails. A disabled field's own text stays ink-faint, since WCAG exempts
  // inactive controls (see docs/decisions/0008-console-visual-system.md).
  return `w-full rounded-md border ${border} bg-surface px-2.5 py-1.5 text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-faint ${FOCUS_RING} ${extra}`;
}

export const FIELD_LABEL_CLASSES = EYEBROW_CLASSES;
export const FIELD_ERROR_CLASSES = "text-xs text-severity-p0";

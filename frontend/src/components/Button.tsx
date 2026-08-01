import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

// One shared focus-ring treatment, defined once — every interactive
// primitive in this system (Button, Input, Select, TextArea,
// DateTimeInput) uses this exact string so keyboard focus looks and
// behaves identically everywhere, never a per-component one-off.
// Neutral, not coloured — colour is rationed to severity. Works in both modes
// (ink ring reads on any surface; offset matches the panel).
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ink focus-visible:ring-offset-surface-muted";

// Ink-on-panel, so the same classes read correctly in both modes (the button
// is ink-coloured, its label is panel-coloured — always contrasting). Colour
// stays rationed: only `danger` borrows the P0 severity hue, since a
// destructive action shares the "critical" meaning.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-surface-muted hover:bg-ink/85 disabled:bg-border-strong disabled:text-ink-faint",
  secondary:
    "bg-surface text-ink border border-border-strong hover:bg-surface-raised disabled:text-ink-faint disabled:bg-surface disabled:border-border",
  danger:
    "bg-severity-p0 text-surface-muted hover:opacity-90 disabled:bg-border-strong disabled:text-ink-faint",
};

export function Spinner({ className = "h-4 w-4" }: { className?: string }): JSX.Element {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

/** disabled and loading are distinct but overlapping: loading always disables the button (no double-submit), but a disabled button isn't necessarily loading. */
export function Button({
  variant = "primary",
  loading = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${FOCUS_RING} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

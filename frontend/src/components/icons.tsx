// A small, hand-drawn icon set shared across the design system —
// StateBadge, EmptyState, ErrorState, and Toast all pull from here rather
// than each inlining their own SVG, so the whole app has one consistent
// stroke weight and geometry instead of visually mismatched icons per
// component. Deliberately not a library dependency (see the "do not
// install a component library" constraint) — every icon here is a few
// primitive shapes, not worth a package for.

export interface IconProps {
  readonly className?: string;
}

export function CheckCircleIcon({ className = "h-5 w-5" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" className="stroke-current" strokeWidth="1.5" />
      <path
        d="M6.5 10.5l2.2 2.2 4.8-5"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function XCircleIcon({ className = "h-5 w-5" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" className="stroke-current" strokeWidth="1.5" />
      <path
        d="M7.5 7.5l5 5m0-5l-5 5"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ExclamationTriangleIcon({ className = "h-5 w-5" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 3.5l8 14H2l8-14z"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8.5v3.5" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.75" className="fill-current" />
    </svg>
  );
}

export function InboxIcon({ className = "h-8 w-8" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 12h4l2 3h4l2-3h4"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M6 5h12l2 7v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7l2-7z"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClockIcon({ className = "h-3 w-3" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" className="stroke-current" strokeWidth="1.5" />
      <path
        d="M8 4.5V8l2.5 1.5"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArchiveIcon({ className = "h-3 w-3" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect
        x="2"
        y="3"
        width="12"
        height="3"
        rx="0.5"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <path
        d="M3 6.5v5.5a1 1 0 001 1h8a1 1 0 001-1V6.5"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <path d="M6.5 8.5h3" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function DotIcon({ className = "h-2.5 w-2.5" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden="true">
      <circle cx="4" cy="4" r="4" className="fill-current" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "h-4 w-4" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 6l4 4 4-4"
        className="stroke-current"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

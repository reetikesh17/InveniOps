import type { IconProps } from "../../components/icons";

// Analytics-only glyphs, same hand-drawn style / stroke language as
// components/icons.tsx (no icon library — see that file's note).

export function BarChartIcon({ className = "h-5 w-5" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 21h18" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
      <rect
        x="5"
        y="12"
        width="3.5"
        height="6"
        rx="0.5"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <rect
        x="10.25"
        y="8"
        width="3.5"
        height="10"
        rx="0.5"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <rect
        x="15.5"
        y="4"
        width="3.5"
        height="14"
        rx="0.5"
        className="stroke-current"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function ServerIcon({ className = "h-4 w-4" }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect
        x="2"
        y="2.5"
        width="12"
        height="4.5"
        rx="1"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <rect
        x="2"
        y="9"
        width="12"
        height="4.5"
        rx="1"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <circle cx="4.75" cy="4.75" r="0.6" className="fill-current" />
      <circle cx="4.75" cy="11.25" r="0.6" className="fill-current" />
    </svg>
  );
}

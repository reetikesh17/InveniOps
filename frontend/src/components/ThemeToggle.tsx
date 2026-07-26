import { useTheme } from "../hooks/useTheme";
import { FOCUS_RING } from "./Button";

function SunIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" className="stroke-current" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"
        className="stroke-current"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" className="stroke-current" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function ThemeToggle(): JSX.Element {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-muted hover:bg-surface hover:text-ink ${FOCUS_RING}`}
    >
      {theme === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

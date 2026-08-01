import { Link, NavLink } from "react-router-dom";
import { useIncidents } from "../hooks/useIncidents";
import { useAuth } from "../hooks/useAuth";
import { IncidentHeaderStats } from "../features/incidents/IncidentHeaderStats";
import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { ThemeToggle } from "./ThemeToggle";
import { FOCUS_RING } from "./Button";
import { DISPLAY_HEADING_CLASSES, EYEBROW_CLASSES } from "./typography";

function CurrentUser(): JSX.Element | null {
  const { user, logout } = useAuth();
  if (!user) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-mono-micro lowercase text-ink-muted" title={user.email}>
        {user.name}
      </span>
      <button
        type="button"
        onClick={logout}
        className={`font-mono text-eyebrow uppercase tracking-wider text-ink-muted hover:text-ink ${FOCUS_RING} rounded-sm`}
      >
        Sign out
      </button>
    </div>
  );
}

// Nav items are equipment-style labels: mono, uppercase, tracked (the eyebrow
// rung). Active = full ink (a non-colour cue), inactive = muted.
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-sm font-mono text-eyebrow uppercase tracking-wider ${
    isActive ? "text-ink" : "text-ink-muted hover:text-ink"
  } ${FOCUS_RING}`;
}

// The header carries live system state on every route (not just the Live
// Feed) — so the severity counts and ingestion rate read off the one shared
// IncidentsProvider subscription (see hooks/useIncidents.tsx) rather than
// each page fetching its own copy.
export function Header(): JSX.Element {
  const { data: incidents } = useIncidents();

  return (
    <header className="border-b border-border bg-surface-raised">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
        {/* Wordmark as an equipment stencil */}
        <Link
          to="/app"
          className={`flex items-baseline gap-2 rounded-sm ${DISPLAY_HEADING_CLASSES} ${FOCUS_RING}`}
        >
          Incident Console
          <span className={`${EYEBROW_CLASSES} tracking-widest`}>NOC</span>
        </Link>

        <div className="flex items-center gap-4">
          {/* Style Guide/System intentionally not linked here — /app/styleguide
              stays reachable by direct URL only, not from primary nav. */}
          <nav aria-label="Primary" className="flex items-center gap-4">
            <NavLink to="/app" end className={navLinkClass}>
              Feed
            </NavLink>
            <NavLink to="/app/analytics" className={navLinkClass}>
              Analytics
            </NavLink>
          </nav>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <ConnectionStatusIndicator />
          <ThemeToggle />
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <CurrentUser />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2.5 sm:px-6">
        <IncidentHeaderStats incidents={incidents} />
      </div>
    </header>
  );
}

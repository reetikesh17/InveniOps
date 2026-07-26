import { Link, NavLink } from "react-router-dom";
import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { FOCUS_RING } from "./Button";

// NavLink sets aria-current="page" on the active route automatically, and the
// active style is a non-colour-only cue (weight + ink) so it reads without
// relying on hue.
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded text-sm ${isActive ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"} ${FOCUS_RING}`;
}

export function Header(): JSX.Element {
  return (
    <header className="border-b border-border bg-surface">
      {/* flex-wrap so a narrow (375px) viewport wraps the nav/status below the
          title rather than overflowing the viewport horizontally. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/" className={`rounded text-base font-semibold text-ink sm:text-lg ${FOCUS_RING}`}>
          Incident Management
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <nav aria-label="Primary" className="flex items-center gap-3 sm:gap-4">
            <NavLink to="/" end className={navLinkClass}>
              Feed
            </NavLink>
            <NavLink to="/analytics" className={navLinkClass}>
              Analytics
            </NavLink>
            <NavLink to="/styleguide" className={navLinkClass}>
              Style Guide
            </NavLink>
          </nav>
          <ConnectionStatusIndicator />
        </div>
      </div>
    </header>
  );
}

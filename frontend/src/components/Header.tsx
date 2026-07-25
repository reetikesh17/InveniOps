import { Link } from "react-router-dom";
import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { FOCUS_RING } from "./Button";

export function Header(): JSX.Element {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className={`rounded text-base font-semibold text-ink sm:text-lg ${FOCUS_RING}`}>
          Incident Management
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/styleguide" className={`rounded text-sm text-ink-muted hover:text-ink ${FOCUS_RING}`}>
            Style Guide
          </Link>
          <ConnectionStatusIndicator />
        </div>
      </div>
    </header>
  );
}

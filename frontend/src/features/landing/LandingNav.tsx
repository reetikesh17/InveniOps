import { Link } from "react-router-dom";
import { FOCUS_RING } from "../../components/Button";
import { DISPLAY_HEADING_CLASSES, EYEBROW_CLASSES } from "../../components/typography";

const REPO_URL = "https://github.com/reetikesh17/InveniOps";

function GitHubIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.22.48-2.69-1.07-2.69-1.07-.36-.93-.89-1.17-.89-1.17-.72-.5.06-.49.06-.49.8.06 1.22.83 1.22.83.71 1.21 1.87.86 2.33.66.07-.52.28-.86.5-1.06-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

/**
 * Wordmark left; GitHub + auth CTAs right. Deliberately not the console
 * Header (see components/Header.tsx) — that one carries live incident
 * counts and a signed-in user, neither of which exists for an
 * unauthenticated marketing visitor. Same wordmark treatment, same focus
 * ring, same restraint (no colour outside the primary/secondary buttons'
 * existing rules) — a different component because it has a different job.
 */
export function LandingNav(): JSX.Element {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-6">
        <Link
          to="/"
          className={`flex items-baseline gap-2 rounded-sm ${DISPLAY_HEADING_CLASSES} ${FOCUS_RING}`}
        >
          InveniOps
          <span className={`${EYEBROW_CLASSES} tracking-widest`}>NOC</span>
        </Link>

        <nav aria-label="Primary" className="flex shrink-0 items-center gap-2 sm:gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-1.5 rounded-sm p-1.5 text-ink-muted transition-colors hover:text-ink ${FOCUS_RING}`}
            aria-label="View source on GitHub"
          >
            <GitHubIcon />
          </a>
          <Link
            to="/login"
            className={`whitespace-nowrap rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-raised ${FOCUS_RING}`}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className={`whitespace-nowrap rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-surface-muted transition-colors hover:bg-ink/85 ${FOCUS_RING}`}
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

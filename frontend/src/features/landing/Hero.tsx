import { Link } from "react-router-dom";
import { ErrorBoundary } from "../../components";
import { FOCUS_RING } from "../../components/Button";
import { EYEBROW_CLASSES } from "../../components/typography";
import { SignalCollapseDemo } from "./SignalCollapseDemo";

export function Hero(): JSX.Element {
  return (
    <section className="mx-auto max-w-content px-4 pb-10 pt-12 sm:px-6 sm:pb-14 sm:pt-16">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <p className={`${EYEBROW_CLASSES} tracking-widest`}>Signal → Work item → Closed</p>

          <h1 className="mt-4 font-display text-hero uppercase leading-[1.05] tracking-[0.01em] text-ink">
            Up to 100 signals.
            <br />
            One work item.
            <br />
            Every time.
          </h1>

          <p className="mt-6 max-w-md font-body text-lede text-ink-muted">
            InveniOps ingests failure signals at high volume, collapses repeated noise from the same
            component into a single accountable work item inside a 10-second debounce window, and
            won&rsquo;t let it reach Closed without a documented root cause.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className={`rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface-muted transition-colors hover:bg-ink/85 ${FOCUS_RING}`}
            >
              Get started →
            </Link>
            <Link
              to="/login"
              className={`rounded-md border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-raised ${FOCUS_RING}`}
            >
              Sign in
            </Link>
          </div>
        </div>

        <div>
          <ErrorBoundary label="the live demo">
            <SignalCollapseDemo />
          </ErrorBoundary>
          <p className="mt-2 font-body text-prose text-ink-muted">
            Illustrative — same 100-signal / 10-second debounce rule as the live system, timing
            compressed for display.
          </p>
        </div>
      </div>
    </section>
  );
}

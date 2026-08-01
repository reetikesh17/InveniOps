import { lazy, Suspense } from "react";
import { ErrorBoundary } from "../../components";
import { LandingNav } from "./LandingNav";
import { Hero } from "./Hero";

// Everything below the fold is one deferred chunk — a visitor who never
// scrolls never pays for it. Matches App.tsx's own per-route code-splitting
// convention, just at section granularity instead of route granularity.
const BelowFold = lazy(() => import("./BelowFold"));

export function LandingPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-surface-muted">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-surface-muted"
      >
        Skip to main content
      </a>
      <LandingNav />
      <main id="main-content">
        <Hero />
        <ErrorBoundary label="the rest of this page">
          <Suspense fallback={null}>
            <BelowFold />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { Header } from "./components/Header";
import { ErrorBoundary, IncidentListSkeleton, SystemBanner, ToastProvider } from "./components";
import { HealthProvider } from "./hooks/useSystemHealth";
import { IncidentsProvider } from "./hooks/useIncidents";

// Route-level code splitting: every page is its own chunk, so the initial
// load ships only the shell + the landing route. Analytics in particular
// pulls in recharts (~470 kB), which no other page needs.
const LiveFeedPage = lazy(() =>
  import("./features/incidents/LiveFeedPage").then((m) => ({ default: m.LiveFeedPage })),
);
const IncidentDetailPage = lazy(() =>
  import("./features/incidents/IncidentDetailPage").then((m) => ({
    default: m.IncidentDetailPage,
  })),
);
const AnalyticsPage = lazy(() =>
  import("./features/analytics/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })),
);
const StyleGuidePage = lazy(() =>
  import("./features/styleguide/StyleGuidePage").then((m) => ({ default: m.StyleGuidePage })),
);

// Each route element is (a) error-boundaried so a crash degrades to a
// recoverable card instead of a white screen, and (b) Suspense-wrapped for
// its lazy chunk. The boundary is keyed per route via `label`.
function Route({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={<IncidentListSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function RootLayout(): JSX.Element {
  return (
    <HealthProvider>
      <IncidentsProvider>
        <ToastProvider>
          <div className="min-h-screen bg-surface-muted">
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-surface-muted"
            >
              Skip to main content
            </a>
            <Header />
            <SystemBanner />
            {/* max-w-7xl, not a narrower marketing-page width — this is a dense
                operator tool, and 1440px is a required breakpoint, so the shell
                should actually use that space. */}
            <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
              <Outlet />
            </main>
          </div>
        </ToastProvider>
      </IncidentsProvider>
    </HealthProvider>
  );
}

// createBrowserRouter (a data router), not the <BrowserRouter> component —
// the RCA form's unsaved-changes guard relies on useBlocker, which only works
// under a data router (see features/rca/useUnsavedChangesWarning.ts).
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: "/",
        element: (
          <Route label="the live feed">
            <LiveFeedPage />
          </Route>
        ),
      },
      {
        path: "/incidents/:id",
        element: (
          <Route label="this incident">
            <IncidentDetailPage />
          </Route>
        ),
      },
      {
        path: "/analytics",
        element: (
          <Route label="analytics">
            <AnalyticsPage />
          </Route>
        ),
      },
      {
        path: "/styleguide",
        element: (
          <Route label="the style guide">
            <StyleGuidePage />
          </Route>
        ),
      },
    ],
  },
]);

export function App(): JSX.Element {
  return <RouterProvider router={router} />;
}

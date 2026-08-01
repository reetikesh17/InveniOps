import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { Header } from "./components/Header";
import {
  ErrorBoundary,
  IncidentListSkeleton,
  RequireAuth,
  SystemBanner,
  ToastProvider,
} from "./components";
import { HealthProvider } from "./hooks/useSystemHealth";
import { IncidentsProvider } from "./hooks/useIncidents";
import { AuthProvider } from "./hooks/useAuth";
import { LandingPage } from "./features/landing/LandingPage";

// Route-level code splitting: every page is its own chunk, so the initial
// load ships only the shell + the landing route. Analytics in particular
// pulls in recharts (~470 kB), which no other page needs. LoginPage/SignupPage
// are included — a landing-page visitor who never clicks through to either
// shouldn't pay for their bundle (Lighthouse flagged this as unused JS on
// the landing route before these two were split out).
const LoginPage = lazy(() =>
  import("./features/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const SignupPage = lazy(() =>
  import("./features/auth/SignupPage").then((m) => ({ default: m.SignupPage })),
);
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
  // The public marketing surface. Unprotected, no Header/IncidentsProvider —
  // same reasoning as /login below, plus it's the one page an unauthenticated
  // visitor is actually meant to land on.
  {
    path: "/",
    element: (
      <Route label="the landing page">
        <LandingPage />
      </Route>
    ),
  },
  // Unprotected, deliberately outside RootLayout — no Header, no
  // IncidentsProvider/HealthProvider fetching anything before there's a
  // session to authenticate those requests with.
  {
    path: "/login",
    element: (
      <Route label="sign in">
        <LoginPage />
      </Route>
    ),
  },
  {
    path: "/signup",
    element: (
      <Route label="sign up">
        <SignupPage />
      </Route>
    ),
  },
  {
    element: (
      <RequireAuth>
        <RootLayout />
      </RequireAuth>
    ),
    // The console lives under /app — "/" is the public landing page instead.
    // Keeping the console on its own prefix means the two surfaces can never
    // collide on a path, and an unauthenticated visitor to any /app/* URL
    // still gets the ordinary RequireAuth redirect-and-return-here behavior.
    path: "/app",
    children: [
      {
        index: true,
        element: (
          <Route label="the live feed">
            <LiveFeedPage />
          </Route>
        ),
      },
      {
        path: "incidents/:id",
        element: (
          <Route label="this incident">
            <IncidentDetailPage />
          </Route>
        ),
      },
      {
        path: "analytics",
        element: (
          <Route label="analytics">
            <AnalyticsPage />
          </Route>
        ),
      },
      {
        path: "styleguide",
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
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

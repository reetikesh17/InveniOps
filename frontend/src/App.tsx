import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { Header } from "./components/Header";
import { ToastProvider } from "./components";
import { LiveFeedPage } from "./features/incidents/LiveFeedPage";
import { IncidentDetailPage } from "./features/incidents/IncidentDetailPage";
import { StyleGuidePage } from "./features/styleguide/StyleGuidePage";

function RootLayout(): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-surface-muted">
        <Header />
        {/* max-w-7xl, not a narrower marketing-page width — this is a dense
            operator tool, and 1440px is a required breakpoint, so the shell
            should actually use that space. */}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  );
}

// createBrowserRouter (a data router), not the <BrowserRouter> component —
// the RCA form's unsaved-changes guard relies on useBlocker, which only works
// under a data router (see features/rca/useUnsavedChangesWarning.ts).
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <LiveFeedPage /> },
      { path: "/incidents/:id", element: <IncidentDetailPage /> },
      { path: "/styleguide", element: <StyleGuidePage /> },
    ],
  },
]);

export function App(): JSX.Element {
  return <RouterProvider router={router} />;
}

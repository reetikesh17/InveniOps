import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Header } from "./components/Header";
import { ToastProvider } from "./components";
import { LiveFeedPage } from "./features/incidents/LiveFeedPage";
import { IncidentDetailPage } from "./features/incidents/IncidentDetailPage";
import { StyleGuidePage } from "./features/styleguide/StyleGuidePage";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="min-h-screen bg-surface-muted">
          <Header />
          {/* max-w-7xl, not a narrower marketing-page width — this is a
              dense operator tool, and 1440px is a required breakpoint, so
              the shell should actually use that space. */}
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            <Routes>
              <Route path="/" element={<LiveFeedPage />} />
              <Route path="/incidents/:id" element={<IncidentDetailPage />} />
              <Route path="/styleguide" element={<StyleGuidePage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}

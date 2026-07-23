import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Header } from "./components/Header";
import { LiveFeedPage } from "./features/incidents/LiveFeedPage";
import { IncidentDetailPage } from "./features/incidents/IncidentDetailPage";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-50">
        <Header />
        <main className="mx-auto max-w-5xl px-6 py-8">
          <Routes>
            <Route path="/" element={<LiveFeedPage />} />
            <Route path="/incidents/:id" element={<IncidentDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

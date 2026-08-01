import { EYEBROW_CLASSES } from "../../components/typography";

interface Mechanic {
  readonly label: string;
  readonly body: string;
}

// Every claim below cites a real config default or a real enforcement point
// (backend/src/config/index.ts, backend/src/services/ingestion/buffer.ts,
// backend/src/domain/state/) — see docs/backpressure.md and ADR 0009 for the
// full writeups these compress.
const MECHANICS: readonly Mechanic[] = [
  {
    label: "Debounce",
    body: "100 signals or 10 seconds, whichever comes first — one work item either way. Enforced twice: a Redis session for speed, a Postgres partial unique index as the actual correctness guarantee.",
  },
  {
    label: "Backpressure",
    body: "A 20,000-slot ring buffer per severity. Past the 80% watermark, low-severity signals shed first — P3 down to 15% of capacity, P0 exempt. The caller gets 202 or 503 buffer_saturated, never a hang.",
  },
  {
    label: "Close gate",
    body: "RCA completeness is enforced inside the state machine itself (ResolvedState's own guard), not the API layer — CLOSED is structurally unreachable without a documented root cause, not just rejected by a check someone remembered to add.",
  },
];

export function MechanicStrip(): JSX.Element {
  return (
    <section className="border-t border-border py-16 md:py-section" aria-labelledby="mechanic-heading">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <h2 id="mechanic-heading" className={`${EYEBROW_CLASSES} tracking-widest`}>
          Mechanic
        </h2>

        <div className="mt-6 grid gap-8 md:grid-cols-3 md:gap-6">
          {MECHANICS.map((m) => (
            <div key={m.label} className="border-t border-border-strong pt-4">
              <h3 className="font-mono text-mono-id font-medium uppercase tracking-wider text-ink">
                {m.label}
              </h3>
              <p className="mt-2 font-body text-prose text-ink-muted">{m.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

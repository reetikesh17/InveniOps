import { EYEBROW_CLASSES } from "../../components/typography";
import { ArchitectureDiagram } from "./ArchitectureDiagram";

interface StoreRole {
  readonly store: string;
  readonly holds: string;
  readonly why: string;
}

// Condensed from docs/architecture.md's "Three-store split" table — same
// claims, same reasoning, not softened.
const STORES: readonly StoreRole[] = [
  {
    store: "PostgreSQL",
    holds: "work_items, rca_records, state_transitions — the source of truth.",
    why: "Real multi-row ACID transactions: a state transition and its audit row commit together, or neither does.",
  },
  {
    store: "MongoDB",
    holds: "The raw signal audit log, plus five time-series collections for aggregation.",
    why: "Schemaless and cheap to write at burst volume — putting the audit log in Postgres would couple burst-write throughput to the transactional store.",
  },
  {
    store: "Redis",
    holds: "Dashboard hot-path state, the BullMQ queue, and the rate limiter's token buckets.",
    why: "Sub-millisecond reads for a UI that refreshes constantly, and the one store actually shared across replicas.",
  },
];

export function DataArchitecture(): JSX.Element {
  return (
    <section
      className="border-t border-border py-16 md:py-section"
      aria-labelledby="architecture-heading"
    >
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <h2 id="architecture-heading" className={`${EYEBROW_CLASSES} tracking-widest`}>
          Data architecture
        </h2>
        <p className="mt-3 max-w-2xl font-body text-lede text-ink-muted">
          Three stores, three jobs, on purpose — not one database asked to do everything.
        </p>

        <div className="mt-8">
          <ArchitectureDiagram />
        </div>

        <div className="mt-10 grid gap-6 border-t border-border-strong pt-8 md:grid-cols-3">
          {STORES.map((s) => (
            <div key={s.store}>
              <h3 className="font-mono text-mono-id font-medium uppercase tracking-wider text-ink">
                {s.store}
              </h3>
              <p className="mt-2 font-body text-prose text-ink">{s.holds}</p>
              <p className="mt-1.5 font-body text-prose text-ink-muted">{s.why}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

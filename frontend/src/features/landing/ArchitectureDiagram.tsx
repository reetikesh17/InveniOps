import { MONO_MICRO_CLASSES } from "../../components/typography";

interface Stage {
  readonly label: string;
  readonly nodes: readonly string[];
  /** What moves to the next stage — the mermaid source's own edge labels, condensed. */
  readonly next?: string;
}

// Reproduces the README's architecture diagram (graph LR) as a linear,
// top-to-bottom pipeline — the same nodes and the same real edges,
// grouped into stages instead of auto-routed, so it stays legible at any
// width instead of shrinking an unreadable wide graph down to fit a phone.
const STAGES: readonly Stage[] = [
  {
    label: "Signal sources",
    nodes: ["APIs", "MCP hosts", "Caches", "Queues", "RDBMS", "NoSQL"],
    next: "HTTP POST, JSON — single or array",
  },
  {
    label: "Ingestion",
    nodes: ["Rate limiter (Redis token bucket, fails open)", "Ingestion API (Express)"],
    next: "if allowed: buffer and ack 202 immediately",
  },
  {
    label: "Buffer & queue",
    nodes: ["Ring buffer (severity-aware shedding)", "Queue (BullMQ / Redis)"],
    next: "debounced signal batch, drain interval",
  },
  {
    label: "Signal workers",
    nodes: ["Signal workers"],
    next: "write raw signal, work item, cache, metrics",
  },
  {
    label: "The three stores",
    nodes: [
      "MongoDB — signals (audit log)",
      "MongoDB — timeseries metrics",
      "PostgreSQL — work_items · rca_records",
      "Redis — dashboard cache",
    ],
    next: "transition / RCA, always transactional",
  },
  {
    label: "Domain APIs",
    nodes: ["Incidents API", "Analytics API", "Alert dispatcher (Strategy)", "Escalation scheduler"],
    next: "SSE push on create/transition · per-channel fan-out",
  },
  {
    label: "Delivered to",
    nodes: ["Console · Slack · PagerDuty · Email", "Dashboard UI (React, SSE)"],
  },
];

function StageNode({ children }: { children: string }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-md border border-border-strong bg-surface px-2.5 py-1 font-mono text-mono-micro text-ink">
      {children}
    </span>
  );
}

/**
 * Reproduced from README.md's "## Architecture" Mermaid diagram — same
 * nodes, same real edges (condensed to their labels), laid out as stages
 * rather than an auto-routed graph. See LandingPage's own note on why this
 * is hand-built HTML instead of the mermaid package.
 */
export function ArchitectureDiagram(): JSX.Element {
  return (
    <ol className="flex flex-col gap-0">
      {STAGES.map((stage, i) => (
        <li key={stage.label}>
          <div className="flex flex-col gap-2 border-l-2 border-border-strong py-3 pl-4 sm:flex-row sm:items-baseline sm:gap-4">
            <span className="w-8 shrink-0 font-mono text-mono-micro text-ink-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-mono-id font-medium uppercase tracking-wider text-ink">
                {stage.label}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {stage.nodes.map((n) => (
                  <StageNode key={n}>{n}</StageNode>
                ))}
              </div>
            </div>
          </div>
          {stage.next && (
            <div className="flex items-start gap-4 pl-4">
              <span className="w-8 shrink-0 text-center text-ink-faint" aria-hidden="true">
                ↓
              </span>
              <p className={`${MONO_MICRO_CLASSES} py-1`}>{stage.next}</p>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

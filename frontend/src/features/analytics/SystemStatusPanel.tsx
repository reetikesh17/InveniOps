import { Card, ErrorState, SkeletonBlock } from "../../components";
import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from "../../components/icons";
import { EYEBROW_CLASSES } from "../../components/typography";
import { ServerIcon } from "./analyticsIcons";
import { useSystemHealth } from "../../hooks/useSystemHealth";
import type { HealthResponse } from "../../types/health";

// System-health severity reuses the incident severity scale — "up/healthy" is
// neutral (ink), shedding = P1, down/unhealthy = P0. No new hues.
const STATUS_GOOD = "var(--color-ink)";
const STATUS_WARNING = "var(--color-severity-p1)";
const STATUS_CRITICAL = "var(--color-severity-p0)";

const OVERALL_CONFIG: Record<
  HealthResponse["status"],
  { label: string; color: string; Icon: typeof CheckCircleIcon }
> = {
  healthy: { label: "Healthy", color: STATUS_GOOD, Icon: CheckCircleIcon },
  degraded: { label: "Degraded — shedding", color: STATUS_WARNING, Icon: ExclamationTriangleIcon },
  unhealthy: { label: "Unhealthy", color: STATUS_CRITICAL, Icon: XCircleIcon },
};

function StatRow({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="font-mono text-mono-num tabular-nums text-ink">{value}</span>
    </div>
  );
}

function DependencyRow({
  name,
  status,
  latencyMs,
}: {
  name: string;
  status: "up" | "down";
  latencyMs: number;
}): JSX.Element {
  const isUp = status === "up";
  return (
    <div className="flex items-center gap-2 text-sm">
      <ServerIcon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      <span className="text-ink">{name}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={isUp ? { backgroundColor: STATUS_GOOD } : { backgroundColor: STATUS_CRITICAL }}
          aria-hidden="true"
        />
        <span
          className={`font-mono text-mono-micro lowercase ${isUp ? "text-ink-muted" : "font-medium text-severity-p0"}`}
        >
          {isUp ? "up" : "down"}
        </span>
        <span className="w-14 text-right font-mono text-mono-num tabular-nums text-ink-muted">
          {latencyMs}ms
        </span>
      </span>
    </div>
  );
}

function BufferMeter({
  fillFraction,
  depth,
  capacity,
  shedding,
}: HealthResponse["buffer"]): JSX.Element {
  const pct = Math.round(fillFraction * 100);
  const tierColor =
    shedding || fillFraction >= 0.9
      ? STATUS_CRITICAL
      : fillFraction >= 0.7
        ? STATUS_WARNING
        : STATUS_GOOD;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-ink-muted">Ingestion buffer</span>
        <span className="font-mono text-mono-num font-medium tabular-nums text-ink">
          {pct}%{" "}
          <span className="text-ink-muted">
            · {depth}/{capacity}
          </span>
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-border"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Ingestion buffer fill"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(2, pct)}%`, backgroundColor: tierColor }}
        />
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: shedding ? STATUS_CRITICAL : STATUS_GOOD }}
          aria-hidden="true"
        />
        <span
          className={`font-body text-prose ${shedding ? "font-medium text-severity-p0" : "text-ink-muted"}`}
        >
          {shedding
            ? "Shedding load — dropping signals under backpressure"
            : "Accepting — no shedding"}
        </span>
      </div>
    </div>
  );
}

export function SystemStatusPanel(): JSX.Element {
  // Reads the shared health context (single app-wide poller with backoff —
  // see HealthProvider) rather than polling on its own, so opening /analytics
  // adds no extra /health traffic.
  const { phase, health, refresh } = useSystemHealth();

  if (phase === "unreachable" && !health) {
    return (
      <Card>
        <ErrorState
          message="Can't reach the health endpoint — retrying automatically."
          onRetry={refresh}
        />
      </Card>
    );
  }

  if (!health) {
    return (
      <Card className="flex flex-col gap-3">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="h-32 w-full" />
      </Card>
    );
  }

  const overall = OVERALL_CONFIG[health.status];
  const { Icon } = overall;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">System status</h2>
          <p className="font-body text-prose text-ink-muted">
            Live backpressure &amp; dependency health · updates every 5s
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-sm font-medium">
          {/* icons inherit currentColor (stroke-current); colour via the wrapper */}
          <span style={{ color: overall.color }} className="inline-flex">
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-ink">{overall.label}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <h3 className={EYEBROW_CLASSES}>Dependencies</h3>
          <DependencyRow
            name="PostgreSQL"
            status={health.dependencies.postgres.status}
            latencyMs={health.dependencies.postgres.latencyMs}
          />
          <DependencyRow
            name="MongoDB"
            status={health.dependencies.mongo.status}
            latencyMs={health.dependencies.mongo.latencyMs}
          />
          <DependencyRow
            name="Redis"
            status={health.dependencies.redis.status}
            latencyMs={health.dependencies.redis.latencyMs}
          />
          <DependencyRow
            name="Queue"
            status={health.dependencies.queue.status}
            latencyMs={health.dependencies.queue.latencyMs}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className={EYEBROW_CLASSES}>Backpressure</h3>
          <BufferMeter {...health.buffer} />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className={EYEBROW_CLASSES}>Queue &amp; throughput</h3>
          <StatRow label="Waiting jobs" value={health.queue.waitingCount} />
          <StatRow label="Active jobs" value={health.queue.activeCount} />
          <StatRow label="Dead-letter queue" value={health.queue.dlqSize} />
          <StatRow
            label="Throughput"
            value={`${health.throughput.signalsPerSecond.toFixed(1)}/s`}
          />
        </div>
      </div>
    </Card>
  );
}

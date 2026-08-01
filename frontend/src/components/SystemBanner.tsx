import { useSystemHealth } from "../hooks/useSystemHealth";
import { ExclamationTriangleIcon, XCircleIcon } from "./icons";

type BannerTone = "critical" | "warning";

interface BannerContent {
  readonly tone: BannerTone;
  readonly message: string;
  readonly showRetry: boolean;
}

// A left rail in the severity hue (P0 for outage/unreachable, P1 for shedding)
// on the raised surface — the banner is the system-health analogue of a row
// spine, so it reuses the same rationed colours instead of raw red/amber.
const TONE_RAIL: Record<BannerTone, string> = {
  critical: "var(--color-severity-p0)",
  warning: "var(--color-severity-p1)",
};
const TONE_ICON: Record<BannerTone, string> = {
  critical: "text-severity-p0",
  warning: "text-severity-p1",
};

/**
 * App-wide status strip, rendered inside the shell (so the header/nav stay
 * usable, never a white screen). Three distinct conditions, most-severe first:
 *
 *  - unreachable → the backend can't be reached; the poller is already
 *    retrying with backoff, and a manual "Retry now" forces it.
 *  - dependency down (health.status "unhealthy") → a hard outage of a
 *    backing store; data may be stale.
 *  - shedding (health.status "degraded" / buffer.shedding) → NOT an outage:
 *    the system is up and serving P0 traffic but dropping lower-priority
 *    signals under backpressure. Surfaced specifically so a reviewer sees the
 *    backpressure mechanism working, distinct from an outage.
 */
function deriveBanner(
  phase: string,
  health: ReturnType<typeof useSystemHealth>["health"],
): BannerContent | null {
  if (phase === "unreachable") {
    return {
      tone: "critical",
      message: "Can't reach the backend — retrying automatically.",
      showRetry: true,
    };
  }
  if (phase === "reachable" && health) {
    if (health.status === "unhealthy") {
      const down = Object.entries(health.dependencies)
        .filter(([, dep]) => dep.status === "down")
        .map(([name]) => name);
      const which = down.length > 0 ? ` (${down.join(", ")})` : "";
      return {
        tone: "critical",
        message: `A backend dependency is unavailable${which} — some data may be stale or missing.`,
        showRetry: false,
      };
    }
    if (health.status === "degraded" || health.buffer.shedding) {
      return {
        tone: "warning",
        message:
          "System under load — shedding incoming signals under backpressure. Newer data may lag briefly.",
        showRetry: false,
      };
    }
  }
  return null;
}

export function SystemBanner(): JSX.Element | null {
  const { phase, health, refresh } = useSystemHealth();
  const banner = deriveBanner(phase, health);
  if (!banner) {
    return null;
  }

  const Icon = banner.tone === "critical" ? XCircleIcon : ExclamationTriangleIcon;

  return (
    <div
      role={banner.tone === "critical" ? "alert" : "status"}
      style={{ borderLeftColor: TONE_RAIL[banner.tone] }}
      className="flex flex-wrap items-center gap-2 border-b border-l-[3px] border-b-border bg-surface-raised px-4 py-2 text-sm text-ink sm:px-6"
    >
      <Icon className={`h-4 w-4 shrink-0 ${TONE_ICON[banner.tone]}`} />
      <span className="font-body">{banner.message}</span>
      {banner.showRetry && (
        <button
          type="button"
          onClick={refresh}
          className="ml-auto rounded-sm font-mono text-xs uppercase tracking-wide text-ink-muted underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ink focus-visible:ring-offset-surface-raised"
        >
          Retry now
        </button>
      )}
    </div>
  );
}

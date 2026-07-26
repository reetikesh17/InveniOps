import { useSystemHealth } from "../hooks/useSystemHealth";
import { ExclamationTriangleIcon, XCircleIcon } from "./icons";

type BannerTone = "critical" | "warning";

interface BannerContent {
  readonly tone: BannerTone;
  readonly message: string;
  readonly showRetry: boolean;
}

const TONE_CLASSES: Record<BannerTone, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
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
function deriveBanner(phase: string, health: ReturnType<typeof useSystemHealth>["health"]): BannerContent | null {
  if (phase === "unreachable") {
    return { tone: "critical", message: "Can't reach the backend — retrying automatically.", showRetry: true };
  }
  if (phase === "reachable" && health) {
    if (health.status === "unhealthy") {
      const down = Object.entries(health.dependencies)
        .filter(([, dep]) => dep.status === "down")
        .map(([name]) => name);
      const which = down.length > 0 ? ` (${down.join(", ")})` : "";
      return { tone: "critical", message: `A backend dependency is unavailable${which} — some data may be stale or missing.`, showRetry: false };
    }
    if (health.status === "degraded" || health.buffer.shedding) {
      return {
        tone: "warning",
        message: "System under load — shedding incoming signals under backpressure. Newer data may lag briefly.",
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
      className={`flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm sm:px-6 ${TONE_CLASSES[banner.tone]}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{banner.message}</span>
      {banner.showRetry && (
        <button
          type="button"
          onClick={refresh}
          className="ml-auto rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900"
        >
          Retry now
        </button>
      )}
    </div>
  );
}

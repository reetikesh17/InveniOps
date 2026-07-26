import { useSystemHealth } from "../hooks/useSystemHealth";

interface Indicator {
  readonly label: string;
  readonly dotClassName: string;
}

/**
 * The header's at-a-glance health dot. Reads the shared health context (one
 * app-wide poller — see HealthProvider), never its own request. Never colour
 * alone: the text label carries the same state as the dot.
 */
export function ConnectionStatusIndicator(): JSX.Element {
  const { phase, health } = useSystemHealth();

  let indicator: Indicator;
  if (phase === "checking") {
    indicator = { label: "Checking…", dotClassName: "bg-neutral-400" };
  } else if (phase === "unreachable") {
    indicator = { label: "Offline", dotClassName: "bg-red-500" };
  } else if (health?.status === "degraded") {
    indicator = { label: "Degraded", dotClassName: "bg-amber-500" };
  } else if (health?.status === "unhealthy") {
    indicator = { label: "Unhealthy", dotClassName: "bg-red-500" };
  } else {
    indicator = { label: "Connected", dotClassName: "bg-emerald-500" };
  }

  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <span className={`h-2 w-2 rounded-full ${indicator.dotClassName}`} aria-hidden="true" />
      <span>{indicator.label}</span>
    </div>
  );
}

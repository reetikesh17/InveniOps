import { useSystemHealth } from "../hooks/useSystemHealth";
import { SEVERITY_COLOR_VAR } from "./severity";
import { MONO_MICRO_CLASSES } from "./typography";

/**
 * Header health dot. Colour stays rationed: "connected" is neutral (a filled
 * ink dot), and only a degraded/down/offline state borrows the severity scale
 * (amber = shedding, red = down/offline) — the same four hues used everywhere
 * else. The text label always carries the state independently of colour.
 */
export function ConnectionStatusIndicator(): JSX.Element {
  const { phase, health } = useSystemHealth();

  let label: string;
  let dotColor: string;
  let filled = true;

  if (phase === "checking") {
    label = "connecting";
    dotColor = "var(--color-ink-faint)";
    filled = false;
  } else if (phase === "unreachable") {
    label = "offline";
    dotColor = SEVERITY_COLOR_VAR.P0;
  } else if (health?.status === "degraded") {
    label = "shedding";
    dotColor = SEVERITY_COLOR_VAR.P1;
  } else if (health?.status === "unhealthy") {
    label = "degraded";
    dotColor = SEVERITY_COLOR_VAR.P0;
  } else {
    label = "connected";
    dotColor = "var(--color-ink)";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${MONO_MICRO_CLASSES}`}>
      <span
        className="h-2 w-2 rounded-full"
        style={
          filled ? { backgroundColor: dotColor } : { boxShadow: `inset 0 0 0 1.5px ${dotColor}` }
        }
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

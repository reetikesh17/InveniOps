import { useEffect, useMemo, useRef, useState } from "react";
import { StateBadge } from "../../components";
import { severityColor } from "../../components/severity";
import { MONO_ID_CLASSES, MONO_MICRO_CLASSES, TITLE_CLASSES } from "../../components/typography";
import type { ComponentType, Severity } from "../../types";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface Scenario {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly title: string;
  readonly targetSignals: number;
  // Which of the debounce rule's two conditions ends this session first —
  // the real mechanic (backend/src/config/index.ts) is "100 signals OR 10
  // seconds, whichever comes first," and the demo deliberately shows both.
  readonly trigger: "threshold" | "window";
}

const SCENARIOS: readonly Scenario[] = [
  {
    componentId: "CACHE_CLUSTER_03",
    componentType: "CACHE",
    severity: "P1",
    title: "Cache cluster read timeout",
    targetSignals: 100,
    trigger: "threshold",
  },
  {
    componentId: "RDBMS_PRIMARY_02",
    componentType: "RDBMS",
    severity: "P0",
    title: "Primary write latency spike",
    targetSignals: 34,
    trigger: "window",
  },
];

const STREAM_MS = 3400;
const COLLAPSE_MS = 450;
const SETTLE_MS = 2600;
const TICKS = 24;

type Phase = "streaming" | "collapsing" | "settled";

function DemoIncidentRow({ scenario }: { scenario: Scenario }): JSX.Element {
  return (
    <div
      className="flex animate-row-enter items-center gap-3 border-l-[3px] border-t border-border bg-surface-raised px-3 py-2"
      style={{ borderLeftColor: severityColor(scenario.severity) }}
    >
      <span className={`${MONO_ID_CLASSES} w-7 shrink-0 font-medium`}>{scenario.severity}</span>
      <span className={`${MONO_ID_CLASSES} w-36 shrink-0 truncate`}>{scenario.componentId}</span>
      <span className={`${TITLE_CLASSES} min-w-0 flex-1 truncate`}>{scenario.title}</span>
      <span className={`${MONO_MICRO_CLASSES} hidden shrink-0 sm:inline`}>
        {scenario.targetSignals} signals linked
      </span>
      <StateBadge state="OPEN" className="shrink-0" />
    </div>
  );
}

/**
 * The hero's signature moment: a burst of signals from one component
 * collapses into a single work item, the same debounce rule the backend
 * actually enforces (100 signals or 10 seconds, whichever comes first —
 * see backend/src/config/index.ts's DEBOUNCE_THRESHOLD/DEBOUNCE_WINDOW_SECONDS).
 *
 * Entirely client-side, generated data — not a call to the API. That's
 * deliberate, not a shortcut: this page is public and unauthenticated, the
 * real incident feed is not (see RequireAuth), so there is no "live" version
 * of this demo to fall back FROM. Because it never depends on the backend,
 * it can never break because of the backend — the only degrade path is
 * prefers-reduced-motion, which skips the loop and renders the settled
 * end-state directly, and a render-time error, which ErrorBoundary (see
 * LandingPage.tsx) catches the same way it does for every other route.
 */
export function SignalCollapseDemo(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("streaming");
  const [progress, setProgress] = useState(0); // 0..1 within the current phase
  const startRef = useRef<number>(performance.now());
  const scenario = SCENARIOS[index % SCENARIOS.length];

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    let frame: number;
    startRef.current = performance.now();
    setProgress(0);

    const durations: Record<Phase, number> = {
      streaming: STREAM_MS,
      collapsing: COLLAPSE_MS,
      settled: SETTLE_MS,
    };

    function tick(): void {
      const elapsed = performance.now() - startRef.current;
      const duration = durations[phase];
      const p = Math.min(1, elapsed / duration);
      setProgress(p);
      if (p >= 1) {
        if (phase === "streaming") {
          setPhase("collapsing");
        } else if (phase === "collapsing") {
          setPhase("settled");
        } else {
          setIndex((i) => (i + 1) % SCENARIOS.length);
          setPhase("streaming");
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, reducedMotion]);

  const signalsSoFar = useMemo(() => {
    if (reducedMotion) {
      return scenario.targetSignals;
    }
    if (phase !== "streaming") {
      return scenario.targetSignals;
    }
    return Math.round(progress * scenario.targetSignals);
  }, [progress, phase, scenario.targetSignals, reducedMotion]);

  const secondsRemaining = useMemo(() => {
    const windowSeconds = 10;
    if (reducedMotion || phase !== "streaming") {
      return scenario.trigger === "window" ? 0 : windowSeconds - 6;
    }
    // The threshold scenario "spends" only 6 of its 10s window before the
    // signal cap ends the session first — the window scenario spends the
    // full 10.
    const secondsSpent = (scenario.trigger === "threshold" ? 6 : windowSeconds) * progress;
    return Math.max(0, Math.round(windowSeconds - secondsSpent));
  }, [progress, phase, scenario.trigger, reducedMotion]);

  const filledTicks = Math.round((signalsSoFar / scenario.targetSignals) * TICKS);
  const showSettled = reducedMotion || phase !== "streaming";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className={MONO_ID_CLASSES}>{scenario.componentId}</span>
        <span className={MONO_MICRO_CLASSES} aria-hidden="true">
          {phase === "streaming"
            ? `debounce window 00:${String(secondsRemaining).padStart(2, "0")} remaining`
            : "debounce window closed"}
        </span>
      </div>

      <div className="px-3 py-3" aria-hidden="true">
        {!showSettled ? (
          <>
            <div className="flex items-center gap-1">
              {Array.from({ length: TICKS }, (_, i) => (
                <span
                  key={i}
                  className="h-5 w-1.5 shrink-0 rounded-full transition-colors duration-150"
                  style={{
                    backgroundColor:
                      i < filledTicks ? severityColor(scenario.severity) : "var(--color-border-strong)",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className={MONO_MICRO_CLASSES}>signals buffered</span>
              <span className={`${MONO_ID_CLASSES} tabular-nums`}>
                {signalsSoFar} / {scenario.targetSignals}
              </span>
            </div>
          </>
        ) : (
          <DemoIncidentRow scenario={scenario} />
        )}
      </div>

      <p className="sr-only">
        Demo: a burst of signals from one component collapses into a single work item, following the
        same 100-signal or 10-second debounce rule the backend enforces.
      </p>
    </div>
  );
}

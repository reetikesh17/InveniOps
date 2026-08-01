import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { HealthResponse } from "../types/health";

export type HealthPhase = "checking" | "reachable" | "unreachable";

export interface SystemHealth {
  readonly phase: HealthPhase;
  /** Last successful snapshot; retained across a transient unreachable blip so the UI can show "last known". */
  readonly health: HealthResponse | null;
  readonly refresh: () => void;
}

const HealthContext = createContext<SystemHealth | null>(null);

const BASE_INTERVAL_MS = 5_000; // matches the console reporter cadence
const MAX_BACKOFF_MS = 30_000;

/**
 * The single /health poller for the whole app. It drives three consumers —
 * the header connection dot, the global backpressure/outage banner, and the
 * analytics System Status panel — so there's exactly one request in flight,
 * not three. Polls every 5s while reachable; on a network failure it backs
 * off exponentially (5s → 10s → … → 30s cap) and recovers to 5s on the next
 * success. The request is aborted on unmount and on each manual refresh, so
 * no state update ever lands after teardown.
 *
 * Note a 503 does NOT count as "unreachable": api.getHealth returns the body
 * for a 503 (a dependency down is meaningful data), so that surfaces as
 * phase "reachable" with health.status "unhealthy". Only a genuine
 * network/timeout failure flips the phase to "unreachable".
 */
export function HealthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [phase, setPhase] = useState<HealthPhase>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    let controller: AbortController | null = null;

    async function tick(): Promise<void> {
      controller = new AbortController();
      try {
        const snapshot = await api.getHealth({ signal: controller.signal });
        if (cancelled) {
          return;
        }
        fails = 0;
        setHealth(snapshot);
        setPhase("reachable");
      } catch (error) {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === "AbortError") ||
          controller.signal.aborted
        ) {
          return;
        }
        fails += 1;
        setPhase("unreachable");
      }
      if (!cancelled) {
        const delay =
          fails === 0 ? BASE_INTERVAL_MS : Math.min(BASE_INTERVAL_MS * 2 ** fails, MAX_BACKOFF_MS);
        timer = setTimeout(() => void tick(), delay);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [nonce]);

  const refresh = useCallback((): void => setNonce((n) => n + 1), []);

  const value = useMemo<SystemHealth>(() => ({ phase, health, refresh }), [phase, health, refresh]);

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useSystemHealth(): SystemHealth {
  const ctx = useContext(HealthContext);
  if (!ctx) {
    throw new Error("useSystemHealth must be used within a HealthProvider");
  }
  return ctx;
}

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { HealthResponse } from "../types/health";

export type ConnectionStatus = "checking" | "connected" | "disconnected";

const POLL_INTERVAL_MS = 5000;

export function useHealthStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    async function checkHealth(): Promise<void> {
      try {
        const health = await apiFetch<HealthResponse>("/health");
        if (!cancelled) {
          setStatus(health.status === "healthy" ? "connected" : "disconnected");
        }
      } catch {
        if (!cancelled) {
          setStatus("disconnected");
        }
      }
    }

    void checkHealth();
    const interval = setInterval(() => void checkHealth(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}

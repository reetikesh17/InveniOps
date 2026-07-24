// Mirrors backend src/api/routes/health.ts's HealthResponseBody exactly.
export type DependencyStatus = "up" | "down";

export interface DependencyHealth {
  readonly status: DependencyStatus;
  readonly latencyMs: number;
}

export interface HealthResponse {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly uptimeSeconds: number;
  readonly version: string;
  readonly dependencies: Readonly<{
    postgres: DependencyHealth;
    mongo: DependencyHealth;
    redis: DependencyHealth;
    queue: DependencyHealth;
  }>;
  readonly buffer: Readonly<{
    depth: number;
    capacity: number;
    fillFraction: number;
    shedding: boolean;
  }>;
  readonly queue: Readonly<{
    waitingCount: number;
    activeCount: number;
    dlqSize: number;
  }>;
  readonly throughput: Readonly<{
    signalsPerSecond: number;
  }>;
}

// Mirrors backend/src/api/routes/health.ts's HealthResponseBody.
export type DependencyStatus = "up" | "down";

export interface HealthResponse {
  status: "healthy" | "unhealthy";
  dependencies: {
    postgres: DependencyStatus;
    mongo: DependencyStatus;
    redis: DependencyStatus;
  };
}

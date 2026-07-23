// The WorkItem / RcaRecord / StateTransition domain types will be added
// here once the backend's Postgres schema is approved and implemented —
// see backend/prisma/schema.prisma. Only src/types/health.ts exists today
// because that's the only backend contract currently implemented.
export type { DependencyStatus, HealthResponse } from "./health";

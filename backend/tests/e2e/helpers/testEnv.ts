// E2E tests run on the host against the real docker-compose stack's
// published ports — same posture as tests/chaos/helpers/testEnv.ts, kept
// as its own copy rather than imported from there so this suite's
// infrastructure doesn't couple to the chaos suite's.
export const API_BASE_URL: string = process.env.E2E_API_BASE_URL ?? "http://localhost:3000";
export const DATABASE_URL: string =
  process.env.E2E_DATABASE_URL ?? "postgresql://ims_user:ims_password@localhost:5432/ims";
export const MONGODB_URI: string = process.env.E2E_MONGODB_URI ?? "mongodb://localhost:27017/ims";
export const REDIS_URL: string = process.env.E2E_REDIS_URL ?? "redis://localhost:6379";
export const BACKEND_CONTAINER_NAME: string =
  process.env.E2E_BACKEND_CONTAINER_NAME ?? "inveniops-ims-backend-1";

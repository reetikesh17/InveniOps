// Runs before any chaos test file's imports resolve (wired via
// vitest.chaos.config.ts's setupFiles). None of these tests import
// src/config/index.ts directly, but keeping the same defaults as
// tests/integration/setupEnv.ts here means any helper that someday does
// won't immediately exit the process over a missing env var.
process.env.DATABASE_URL ??= "postgresql://ims_user:ims_password@localhost:5432/ims";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/ims";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_SECRET ??= "chaos-test-placeholder-jwt-secret-not-real-0000";

// Runs before any e2e test file's imports resolve (wired via
// vitest.e2e.config.ts's setupFiles). Same defaults as
// tests/chaos/setupEnv.ts / tests/integration/setupEnv.ts — kept as its
// own copy, not imported from either, so this suite's infrastructure
// doesn't couple to another suite's (see tests/chaos/helpers/testEnv.ts's
// comment for why that's the deliberate convention here).
process.env.DATABASE_URL ??= "postgresql://ims_user:ims_password@localhost:5432/ims";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/ims";
process.env.REDIS_URL ??= "redis://localhost:6379";

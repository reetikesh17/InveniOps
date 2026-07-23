// Runs before any integration test file's imports resolve (wired in via
// vitest.integration.config.ts's setupFiles — imports are hoisted, so
// setting these inside a test file itself would run too late). Most
// integration tests construct their own Postgres/Mongo/Redis clients
// directly and never touch src/config/index.ts. The full-pipeline test
// (tests/integration/workers/pipeline.test.ts) is the exception: it
// imports src/api/app.ts and src/workers/index.ts, which transitively
// import config — that module reads and validates
// DATABASE_URL/MONGODB_URI/REDIS_URL at import time and exits the process
// if they're missing. Integration tests run on the host, not in a
// container, so these default to the same published ports
// TEST_DATABASE_URL etc. already point at (see testEnv.ts).
process.env.DATABASE_URL ??= "postgresql://ims_user:ims_password@localhost:5432/ims";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/ims";
process.env.REDIS_URL ??= "redis://localhost:6379";

// The pipeline test pushes a 10,000-signal burst through the real HTTP
// endpoint in a handful of large batches — comfortably past the default
// rate-limit capacities (50/5000), which exist to protect against network
// abuse, not to throttle a legitimate local load test. The token bucket
// lives in the real (not per-test) Redis, so its state persists across
// separate `npm run test:integration` invocations — capacity alone isn't
// enough; the refill rate also needs to be fast enough that a second run
// moments later isn't still paying down the first run's token debt.
process.env.RATE_LIMIT_IP_CAPACITY ??= "100000";
process.env.RATE_LIMIT_IP_REFILL_PER_SECOND ??= "50000";
process.env.RATE_LIMIT_GLOBAL_CAPACITY ??= "100000";
process.env.RATE_LIMIT_GLOBAL_REFILL_PER_SECOND ??= "50000";

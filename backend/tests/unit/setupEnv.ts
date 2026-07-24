// Runs before any unit test file's imports resolve (wired in via
// vitest.config.ts's setupFiles — imports are hoisted, so setting these
// inside a test file itself would run too late; same reasoning as
// tests/integration/setupEnv.ts). Most unit tests exercise pure modules
// that never import src/config/index.ts, so this is a no-op for them. A
// handful (health/metrics routes, workers/queue.ts) transitively pull in
// config through an impure sibling in the same module even when the test
// only needs a pure export from it — config hard-exits the process if
// these are missing, which would otherwise break the "zero setup" unit
// suite for the whole file. Values are placeholders; nothing in a unit
// test actually connects to them.
process.env.DATABASE_URL ??= "postgresql://ims_user:ims_password@localhost:5432/ims";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/ims";
process.env.REDIS_URL ??= "redis://localhost:6379";

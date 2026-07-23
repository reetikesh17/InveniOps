import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // DB round-trips, real transactions, and the concurrency test's
    // Promise.allSettled race all take longer than a pure unit test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Several of these files share the real Postgres work_items table (and
    // some clean it with an unscoped deleteMany() in afterEach) — running
    // files in parallel would let one file's cleanup wipe rows another
    // file's still-running test depends on. Force files to run one at a
    // time; within a file, tests are still fast enough sequentially.
    fileParallelism: false,
    setupFiles: ["./tests/integration/setupEnv.ts"],
  },
});

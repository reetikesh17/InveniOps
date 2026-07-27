import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/chaos/**/*.test.ts"],
    setupFiles: ["./tests/chaos/setupEnv.ts"],
    // These pause/kill/stop real containers and wait out real retry
    // windows, BullMQ stalled-job detection, and health-probe intervals —
    // minutes per file, not milliseconds. See tests/chaos/README.md for
    // the expected total runtime.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Every file disrupts and restores the SAME shared containers — running
    // files concurrently would let one test's "Postgres is down" fight
    // another's "Postgres should be healthy now" assertion. Sequential,
    // same reasoning as vitest.integration.config.ts.
    fileParallelism: false,
  },
});

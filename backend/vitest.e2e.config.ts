import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    setupFiles: ["./tests/e2e/setupEnv.ts"],
    // 500 signals through the real rate limiter (with retry-on-429 backoff)
    // plus waiting out the real buffer -> queue -> worker pipeline takes
    // real wall-clock time, not milliseconds.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Both files hit the same shared docker-compose backend/Postgres/Mongo/
    // Redis — distinct componentIds keep them from corrupting each other's
    // data, but running them at once would contend for the same real
    // per-IP rate limiter budget in confusing ways. Sequential, same
    // reasoning as vitest.chaos.config.ts / vitest.integration.config.ts.
    fileParallelism: false,
  },
});

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
  },
});

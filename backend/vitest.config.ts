import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/unit/setupEnv.ts"],
    coverage: {
      provider: "v8",
      // Enabled unconditionally (not just under an explicit --coverage
      // flag) so a plain `npm test` — what CI and any contributor actually
      // runs — is itself the enforcement point, per the threshold below.
      enabled: true,
      reporter: ["text", "html"],
      // Scoped to domain + services + the retry util — the layers CLAUDE.md
      // requires to be "unit-testable with zero I/O." src/repositories/**
      // is deliberately NOT in this gate: those files are thin wrappers
      // around real Prisma/Mongo/Redis clients (the actual I/O), covered by
      // tests/integration/repositories/ against the real Dockerized stores
      // instead — mocking the ORM/driver there would just assert the mock
      // does what the mock was told to do, not real behaviour. The
      // exception is repositories/postgres's pure, I/O-free logic
      // (prismaErrors.ts, withPostgresRetry.ts), which unit tests do cover
      // and which sits under src/services-adjacent retry logic in spirit.
      include: ["src/domain/**", "src/services/**", "src/utils/retry.ts", "src/repositories/postgres/prismaErrors.ts", "src/repositories/postgres/withPostgresRetry.ts"],
      // Pure re-export barrels — zero conditional logic, so "coverage" of
      // them is a tooling artifact, not a signal. The modules they
      // re-export from are covered directly, under their own filenames.
      exclude: ["**/index.ts"],
      thresholds: {
        // Set from the actual achieved baseline (~88.7% stmts/lines, ~92%
        // branches, ~83% functions as of this audit), with a few points of
        // headroom so incidental, non-regressive line movement doesn't
        // flake the build — not padded to make an arbitrary round number
        // look reassuring. See README/ADR for what's deliberately excluded
        // and why.
        statements: 85,
        branches: 90,
        functions: 78,
        lines: 85,
      },
    },
  },
});

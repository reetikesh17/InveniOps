import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { withPostgresRetry } from "../../../../src/repositories/postgres/withPostgresRetry.js";

const CLIENT_VERSION = "5.16.1";

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`mock ${code}`, { code, clientVersion: CLIENT_VERSION });
}

// withPostgresRetry hard-codes 3 attempts — asserted directly (not just
// inferred from behaviour) so a change to that constant is a visible,
// deliberate diff to this test, not a silent behaviour change.
const ATTEMPTS = 3;

describe("withPostgresRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on the first attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(withPostgresRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a connection failure (P1001) and succeeds once the connection recovers", async () => {
    const fn = vi.fn().mockRejectedValueOnce(knownError("P1001")).mockResolvedValueOnce("ok");

    const promise = withPostgresRetry(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries a deadlock/serialization conflict (P2034) and succeeds on a later attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(knownError("P2034"))
      .mockRejectedValueOnce(knownError("P2034"))
      .mockResolvedValueOnce("ok");

    const promise = withPostgresRetry(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries a pool-timeout failure (P2024)", async () => {
    const fn = vi.fn().mockRejectedValueOnce(knownError("P2024")).mockResolvedValueOnce("ok");

    const promise = withPostgresRetry(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts all 3 attempts on sustained transient failures and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(knownError("P1001"));

    const promise = withPostgresRetry(fn);
    const assertion = expect(promise).rejects.toMatchObject({ code: "P1001" });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(ATTEMPTS);
  });

  it("does NOT retry a constraint violation (P2002) — fails on the first attempt", async () => {
    const fn = vi.fn().mockRejectedValue(knownError("P2002"));

    await expect(withPostgresRetry(fn)).rejects.toMatchObject({ code: "P2002" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a validation error — fails on the first attempt", async () => {
    const validationError = new Prisma.PrismaClientValidationError("invalid `where` argument", {
      clientVersion: CLIENT_VERSION,
    });
    const fn = vi.fn().mockRejectedValue(validationError);

    await expect(withPostgresRetry(fn)).rejects.toBe(validationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a not-found error (P2025) — fails on the first attempt", async () => {
    const fn = vi.fn().mockRejectedValue(knownError("P2025"));

    await expect(withPostgresRetry(fn)).rejects.toMatchObject({ code: "P2025" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { CachedProbe, probeDependency } from "../../../src/utils/healthProbe.js";

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {
    // deliberately never settles — simulates a hung dependency call
  });
}

describe("probeDependency", () => {
  it("resolves 'up' with a measured latency when the check succeeds", async () => {
    const result = await probeDependency("test", () => Promise.resolve(), 1000);
    expect(result.status).toBe("up");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves 'down' when the check throws", async () => {
    const result = await probeDependency("test", () => Promise.reject(new Error("boom")), 1000);
    expect(result.status).toBe("down");
  });

  it("resolves 'down' within the timeout, not the check's own (unbounded) duration, when the check hangs", async () => {
    const timeoutMs = 30;
    const start = Date.now();

    const result = await probeDependency("test", () => neverResolves<void>(), timeoutMs);

    const elapsed = Date.now() - start;
    expect(result.status).toBe("down");
    // Generous upper bound (well under what a genuinely hung check would
    // take) — proves the timeout, not the hang, decided how long this took.
    expect(elapsed).toBeLessThan(timeoutMs + 200);
  });
});

describe("CachedProbe", () => {
  it("serves the fallback before the first tick has completed", () => {
    const probe = new CachedProbe(() => Promise.resolve("real"), {
      intervalMs: 10_000,
      timeoutMs: 1_000,
      fallback: "fallback",
      label: "test",
    });

    expect(probe.get()).toBe("fallback");
  });

  it("serves the fetched value once start() resolves", async () => {
    const probe = new CachedProbe(() => Promise.resolve("real"), {
      intervalMs: 10_000,
      timeoutMs: 1_000,
      fallback: "fallback",
      label: "test",
    });

    await probe.start();

    expect(probe.get()).toBe("real");
    probe.stop();
  });

  it("start() resolves within the timeout even when fetch hangs, serving the fallback", async () => {
    const timeoutMs = 30;
    const probe = new CachedProbe(() => neverResolves<string>(), {
      intervalMs: 10_000,
      timeoutMs,
      fallback: "fallback",
      label: "test",
    });

    const start = Date.now();
    await probe.start();
    const elapsed = Date.now() - start;

    expect(probe.get()).toBe("fallback");
    expect(elapsed).toBeLessThan(timeoutMs + 200);
    probe.stop();
  });

  it("keeps serving the last known-good snapshot when a later tick fails, rather than going blank", async () => {
    let shouldFail = false;
    const probe = new CachedProbe(
      () => (shouldFail ? Promise.reject(new Error("down")) : Promise.resolve("good")),
      { intervalMs: 10_000, timeoutMs: 1_000, fallback: "fallback", label: "test", logger: { error: vi.fn() } },
    );

    await probe.start();
    expect(probe.get()).toBe("good");

    shouldFail = true;
    // Manually invoke the private tick via the public surface: stop/start
    // again triggers one immediate tick, same code path a real interval
    // firing would take.
    probe.stop();
    await probe.start();

    expect(probe.get()).toBe("good"); // stale, not blank
    probe.stop();
  });
});

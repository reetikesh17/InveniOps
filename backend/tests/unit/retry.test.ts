import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retry } from "../../src/utils/retry.js";

describe("retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on the first try without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retry(fn, { attempts: 3, baseDelayMs: 10 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds after N failures", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");

    const promise = retry(fn, { attempts: 5, baseDelayMs: 10, jitter: false });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after max attempts and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    const promise = retry(fn, { attempts: 3, baseDelayMs: 10, jitter: false });
    const assertion = expect(promise).rejects.toThrow("always fails");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects exponential backoff timing", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const delays: number[] = [];

    const promise = retry(fn, {
      attempts: 4,
      baseDelayMs: 100,
      jitter: false,
      onRetry: (_error, _attempt, delayMs) => delays.push(delayMs),
    });
    const assertion = expect(promise).rejects.toThrow("fail");
    await vi.runAllTimersAsync();
    await assertion;

    expect(delays).toEqual([100, 200, 400]);
  });
});

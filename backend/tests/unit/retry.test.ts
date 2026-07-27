import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retry } from "../../src/utils/retry.js";

describe("retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects immediately when attempts is less than 1, without calling fn", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(retry(fn, { attempts: 0, baseDelayMs: 10 })).rejects.toThrow(
      "retry: attempts must be at least 1",
    );
    expect(fn).not.toHaveBeenCalled();
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

  it("does not retry when shouldRetry returns false, rethrowing immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-transient"));

    const promise = retry(fn, {
      attempts: 5,
      baseDelayMs: 10,
      shouldRetry: () => false,
    });
    const assertion = expect(promise).rejects.toThrow("non-transient");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies jitter by default — the delay is randomized between 0 and the exponential value, not the raw value itself", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const delays: number[] = [];
    const randomSpy = vi.spyOn(Math, "random");

    // Math.random mocked to fixed points along [0, 1) makes the resulting
    // delay deterministic (delay = random() * exponentialDelay), so this
    // asserts the actual jitter formula rather than just "delay is some
    // number in range."
    randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1);

    const promise = retry(fn, {
      attempts: 4,
      baseDelayMs: 100,
      // jitter defaults to true — intentionally not passed here.
      onRetry: (_error, _attempt, delayMs) => delays.push(delayMs),
    });
    const assertion = expect(promise).rejects.toThrow("fail");
    await vi.runAllTimersAsync();
    await assertion;

    // Exponential backoff before jitter would be [100, 200, 400]; jitter
    // scales each by the mocked random draw.
    expect(delays).toEqual([0, 100, 400]);
    randomSpy.mockRestore();
  });

  it("disabling jitter uses the raw exponential delay with no randomization", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const delays: number[] = [];
    const randomSpy = vi.spyOn(Math, "random");

    const promise = retry(fn, {
      attempts: 3,
      baseDelayMs: 100,
      jitter: false,
      onRetry: (_error, _attempt, delayMs) => delays.push(delayMs),
    });
    const assertion = expect(promise).rejects.toThrow("fail");
    await vi.runAllTimersAsync();
    await assertion;

    expect(delays).toEqual([100, 200]);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it("caps the computed delay at maxDelayMs before jitter is applied", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const delays: number[] = [];

    const promise = retry(fn, {
      attempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 250,
      jitter: false,
      onRetry: (_error, _attempt, delayMs) => delays.push(delayMs),
    });
    const assertion = expect(promise).rejects.toThrow("fail");
    await vi.runAllTimersAsync();
    await assertion;

    // Uncapped exponential would be [100, 200, 400] — the third retry is
    // clamped to maxDelayMs.
    expect(delays).toEqual([100, 200, 250]);
  });

  it("retries only errors shouldRetry approves, giving up on the first disapproved one", async () => {
    class TransientError extends Error {}
    class FatalError extends Error {}

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError("try again"))
      .mockRejectedValueOnce(new FatalError("stop"));

    const promise = retry(fn, {
      attempts: 5,
      baseDelayMs: 10,
      jitter: false,
      shouldRetry: (error) => error instanceof TransientError,
    });
    const assertion = expect(promise).rejects.toThrow("stop");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

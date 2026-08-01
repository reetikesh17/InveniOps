export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export interface WaitForOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly description: string;
}

/** Polls `check` until it resolves true, or throws once `timeoutMs` elapses. */
export async function waitFor(
  check: () => Promise<boolean>,
  options: WaitForOptions,
): Promise<void> {
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const suffix = lastError ? ` (last check threw: ${String(lastError)})` : "";
  throw new Error(
    `waitFor timed out after ${options.timeoutMs}ms: ${options.description}${suffix}`,
  );
}

export interface WaitForValueOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly description: string;
}

/** Like waitFor, but returns the value `produce()` returned once `isReady` accepts it, instead of a plain boolean. */
export async function waitForValue<T>(
  produce: () => Promise<T>,
  isReady: (value: T) => boolean,
  options: WaitForValueOptions,
): Promise<T> {
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + options.timeoutMs;
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await produce();
    if (isReady(last)) {
      return last;
    }
    await sleep(intervalMs);
  }

  throw new Error(`waitFor timed out after ${options.timeoutMs}ms: ${options.description}`);
}

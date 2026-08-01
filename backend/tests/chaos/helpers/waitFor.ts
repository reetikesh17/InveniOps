// Generic polling — every "eventually recovers" assertion in this suite
// goes through this, not a fixed sleep, so a test fails with an actual
// timeout message instead of a flaky race against a guessed delay.
export interface WaitForOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly description: string;
}

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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Total number of attempts, including the first try. Must be >= 1. */
  readonly attempts: number;
  /** Delay before the first retry, in milliseconds. Doubles each subsequent attempt. */
  readonly baseDelayMs: number;
  /** Upper bound on the computed delay, before jitter is applied. */
  readonly maxDelayMs?: number;
  /** Randomize each delay between 0 and the computed backoff value. Defaults to true. */
  readonly jitter?: boolean;
  /** Called before each retry sleep, useful for logging. Not called after the final attempt. */
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Only retry when this returns true. Omitted = retry on any error (previous behavior). */
  readonly shouldRetry?: (error: unknown) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    attempts,
    baseDelayMs,
    maxDelayMs = Number.POSITIVE_INFINITY,
    jitter = true,
    onRetry,
    shouldRetry,
  } = options;

  if (attempts < 1) {
    throw new Error("retry: attempts must be at least 1");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isRetryable = shouldRetry ? shouldRetry(error) : true;
      if (!isRetryable || attempt === attempts) {
        break;
      }

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, jitter: boolean): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  return jitter ? Math.random() * capped : capped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  MONGODB_URI: z.string().url(),
  REDIS_URL: z.string().url(),
  // Signal ingestion (src/api/routes/signals.ts)
  INGESTION_MAX_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  INGESTION_BULK_TEST_MAX_COUNT: z.coerce.number().int().positive().default(20_000),
  RATE_LIMIT_IP_CAPACITY: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_IP_REFILL_PER_SECOND: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_GLOBAL_CAPACITY: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_GLOBAL_REFILL_PER_SECOND: z.coerce.number().int().positive().default(2000),
  // In-memory ingestion buffer (src/services/ingestion/buffer.ts)
  BUFFER_CAPACITY: z.coerce.number().int().positive().default(20_000),
  BUFFER_HIGH_WATER_MARK_FRACTION: z.coerce.number().gt(0).lte(1).default(0.8),
  BUFFER_LOW_WATER_MARK_FRACTION: z.coerce.number().gte(0).lt(1).default(0.5),
  BUFFER_SHED_CEILING_P1_FRACTION: z.coerce.number().gt(0).lte(1).default(0.7),
  BUFFER_SHED_CEILING_P2_FRACTION: z.coerce.number().gt(0).lte(1).default(0.4),
  BUFFER_SHED_CEILING_P3_FRACTION: z.coerce.number().gt(0).lte(1).default(0.15),
  BUFFER_DRAIN_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  BUFFER_DRAIN_INTERVAL_MS: z.coerce.number().int().positive().default(50),
  BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Signal debouncing (src/services/ingestion/debouncer.ts)
  DEBOUNCE_WINDOW_SECONDS: z.coerce.number().int().positive().default(10),
  DEBOUNCE_THRESHOLD: z.coerce.number().int().positive().default(100),
  DEBOUNCE_LOCK_TTL_MS: z.coerce.number().int().positive().default(5_000),
  DEBOUNCE_LOCK_WAIT_TIMEOUT_MS: z.coerce.number().int().positive().default(1_000),
  DEBOUNCE_LOCK_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(20),
  // Async signal-processing queue (src/workers/)
  QUEUE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  QUEUE_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(1_000),
  QUEUE_REMOVE_ON_COMPLETE_COUNT: z.coerce.number().int().positive().default(1_000),
  QUEUE_REMOVE_ON_FAIL_COUNT: z.coerce.number().int().positive().default(1_000),
  QUEUE_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Dashboard read path (src/services/dashboard/, src/api/routes/workitems.ts)
  DASHBOARD_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  DASHBOARD_LIST_DEFAULT_LIMIT: z.coerce.number().int().positive().default(50),
  DASHBOARD_LIST_MAX_LIMIT: z.coerce.number().int().positive().default(200),
  DASHBOARD_REPOPULATE_CAP: z.coerce.number().int().positive().default(1_000),
}).refine((env) => env.BUFFER_LOW_WATER_MARK_FRACTION < env.BUFFER_HIGH_WATER_MARK_FRACTION, {
  message: "BUFFER_LOW_WATER_MARK_FRACTION must be less than BUFFER_HIGH_WATER_MARK_FRACTION",
  path: ["BUFFER_LOW_WATER_MARK_FRACTION"],
}).refine(
  (env) =>
    env.BUFFER_SHED_CEILING_P3_FRACTION < env.BUFFER_SHED_CEILING_P2_FRACTION &&
    env.BUFFER_SHED_CEILING_P2_FRACTION < env.BUFFER_SHED_CEILING_P1_FRACTION,
  {
    message: "shed ceiling fractions must satisfy P3 < P2 < P1 — lower severities must have less headroom",
    path: ["BUFFER_SHED_CEILING_P2_FRACTION"],
  },
);

export interface AppConfig {
  readonly env: "development" | "test" | "production";
  readonly port: number;
  readonly postgres: {
    readonly url: string;
  };
  readonly mongo: {
    readonly uri: string;
  };
  readonly redis: {
    readonly url: string;
  };
  readonly ingestion: {
    readonly maxBatchSize: number;
    readonly bulkTestMaxCount: number;
  };
  readonly rateLimit: {
    readonly ip: { readonly capacity: number; readonly refillPerSecond: number };
    readonly global: { readonly capacity: number; readonly refillPerSecond: number };
  };
  readonly buffer: {
    readonly capacity: number;
    readonly highWaterMarkFraction: number;
    readonly lowWaterMarkFraction: number;
    readonly shedCeilingFractions: { readonly p1: number; readonly p2: number; readonly p3: number };
    readonly drainBatchSize: number;
    readonly drainIntervalMs: number;
    readonly shutdownDrainTimeoutMs: number;
  };
  readonly debounce: {
    readonly windowSeconds: number;
    readonly threshold: number;
    readonly lockTtlMs: number;
    readonly lockWaitTimeoutMs: number;
    readonly lockPollIntervalMs: number;
  };
  readonly queue: {
    readonly workerConcurrency: number;
    readonly maxAttempts: number;
    readonly backoffDelayMs: number;
    readonly removeOnCompleteCount: number;
    readonly removeOnFailCount: number;
    readonly shutdownTimeoutMs: number;
  };
  readonly dashboard: {
    readonly cacheTtlSeconds: number;
    readonly listDefaultLimit: number;
    readonly listMaxLimit: number;
    readonly repopulateCap: number;
  };
}

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  const env = parsed.data;

  return Object.freeze({
    env: env.NODE_ENV,
    port: env.PORT,
    postgres: Object.freeze({ url: env.DATABASE_URL }),
    mongo: Object.freeze({ uri: env.MONGODB_URI }),
    redis: Object.freeze({ url: env.REDIS_URL }),
    ingestion: Object.freeze({
      maxBatchSize: env.INGESTION_MAX_BATCH_SIZE,
      bulkTestMaxCount: env.INGESTION_BULK_TEST_MAX_COUNT,
    }),
    rateLimit: Object.freeze({
      ip: Object.freeze({
        capacity: env.RATE_LIMIT_IP_CAPACITY,
        refillPerSecond: env.RATE_LIMIT_IP_REFILL_PER_SECOND,
      }),
      global: Object.freeze({
        capacity: env.RATE_LIMIT_GLOBAL_CAPACITY,
        refillPerSecond: env.RATE_LIMIT_GLOBAL_REFILL_PER_SECOND,
      }),
    }),
    buffer: Object.freeze({
      capacity: env.BUFFER_CAPACITY,
      highWaterMarkFraction: env.BUFFER_HIGH_WATER_MARK_FRACTION,
      lowWaterMarkFraction: env.BUFFER_LOW_WATER_MARK_FRACTION,
      shedCeilingFractions: Object.freeze({
        p1: env.BUFFER_SHED_CEILING_P1_FRACTION,
        p2: env.BUFFER_SHED_CEILING_P2_FRACTION,
        p3: env.BUFFER_SHED_CEILING_P3_FRACTION,
      }),
      drainBatchSize: env.BUFFER_DRAIN_BATCH_SIZE,
      drainIntervalMs: env.BUFFER_DRAIN_INTERVAL_MS,
      shutdownDrainTimeoutMs: env.BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS,
    }),
    debounce: Object.freeze({
      windowSeconds: env.DEBOUNCE_WINDOW_SECONDS,
      threshold: env.DEBOUNCE_THRESHOLD,
      lockTtlMs: env.DEBOUNCE_LOCK_TTL_MS,
      lockWaitTimeoutMs: env.DEBOUNCE_LOCK_WAIT_TIMEOUT_MS,
      lockPollIntervalMs: env.DEBOUNCE_LOCK_POLL_INTERVAL_MS,
    }),
    queue: Object.freeze({
      workerConcurrency: env.QUEUE_WORKER_CONCURRENCY,
      maxAttempts: env.QUEUE_MAX_ATTEMPTS,
      backoffDelayMs: env.QUEUE_BACKOFF_DELAY_MS,
      removeOnCompleteCount: env.QUEUE_REMOVE_ON_COMPLETE_COUNT,
      removeOnFailCount: env.QUEUE_REMOVE_ON_FAIL_COUNT,
      shutdownTimeoutMs: env.QUEUE_SHUTDOWN_TIMEOUT_MS,
    }),
    dashboard: Object.freeze({
      cacheTtlSeconds: env.DASHBOARD_CACHE_TTL_SECONDS,
      listDefaultLimit: env.DASHBOARD_LIST_DEFAULT_LIMIT,
      listMaxLimit: env.DASHBOARD_LIST_MAX_LIMIT,
      repopulateCap: env.DASHBOARD_REPOPULATE_CAP,
    }),
  });
}

export const config: AppConfig = loadConfig();

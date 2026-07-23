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
});

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
  });
}

export const config: AppConfig = loadConfig();

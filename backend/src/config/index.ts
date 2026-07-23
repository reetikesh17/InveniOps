import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  MONGODB_URI: z.string().url(),
  REDIS_URL: z.string().url(),
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
  });
}

export const config: AppConfig = loadConfig();

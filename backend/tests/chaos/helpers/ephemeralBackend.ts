// A second, temporary backend container — same image as the real
// docker-compose service, joined to the same network and pointed at the
// same real Postgres/Mongo/Redis, but with its own port and env overrides.
//
// Why this exists: the queue-saturation scenario needs to push well past
// the ingestion BUFFER's capacity to prove watermark/shedding behavior, but
// the real backend's rate limiter (per-IP: 50 capacity / 20 per second by
// default) sits in front of the buffer and would reject almost everything
// this test tries to send long before the buffer ever felt pressure —
// chaos tests hit the real container over HTTP, so (unlike
// tests/integration/setupEnv.ts, which raises rate limits by setting env
// vars an in-process app reads at import time) there's no way to change
// the ALREADY-RUNNING dev container's config from here. Rather than touch
// the shared dev stack's backend (which every other chaos test, and the
// developer's own `docker compose up`, depends on staying exactly as
// configured), this spins up an independent instance with elevated rate
// limits and a small buffer capacity (so the test converges in seconds,
// not the ~15 minutes the real 20,000-capacity buffer would take to fill
// even with the limiter out of the way) — same code, same shared
// datastores, isolated config, always torn down after.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { waitFor } from "./waitFor.js";

const execFileAsync = promisify(execFile);

const IMAGE = "inveniops-ims-backend:latest";
const NETWORK = "inveniops-ims_ims-network";

export interface EphemeralBackend {
  readonly containerName: string;
  readonly baseUrl: string;
  stop(): Promise<void>;
}

export async function startEphemeralBackend(
  name: string,
  hostPort: number,
  envOverrides: Readonly<Record<string, string>>,
): Promise<EphemeralBackend> {
  const containerName = `chaos-${name}`;
  // In case a previous run's teardown didn't complete — never fail this
  // start over a leftover container from an earlier crashed test run.
  await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => undefined);

  const env: Record<string, string> = {
    NODE_ENV: "production",
    PORT: "3000",
    DATABASE_URL: "postgresql://ims_user:ims_password@postgres:5432/ims",
    MONGODB_URI: "mongodb://mongo:27017/ims",
    REDIS_URL: "redis://redis:6379",
    JWT_SECRET: "ephemeral-chaos-backend-placeholder-jwt-secret-not-real",
    ...envOverrides,
  };

  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "--network",
    NETWORK,
    "-p",
    `${hostPort}:3000`,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    IMAGE,
  ];
  await execFileAsync("docker", args);

  const baseUrl = `http://localhost:${hostPort}`;
  await waitFor(
    async () => {
      try {
        const res = await fetch(`${baseUrl}/health`);
        return res.status === 200 || res.status === 503; // responding at all is enough; 503 can still mean "up, dependency briefly not ready"
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 30_000,
      intervalMs: 500,
      description: `ephemeral backend ${containerName} to respond on /health`,
    },
  );

  return {
    containerName,
    baseUrl,
    async stop(): Promise<void> {
      await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => undefined);
    },
  };
}

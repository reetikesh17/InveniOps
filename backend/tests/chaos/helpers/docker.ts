// Controls the real docker-compose containers by name — these tests run on
// the host (same posture as tests/integration/), against the actual
// Dockerized stack, not a simulation of one. Every disruptive action here
// has a matching restore path, and every test file's own afterEach/afterAll
// calls it — a chaos test that leaves the stack broken for whatever runs
// next (including a developer's own `docker compose ps`) has failed at its
// actual job.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CONTAINERS = {
  backend: "inveniops-ims-backend-1",
  postgres: "inveniops-ims-postgres-1",
  mongo: "inveniops-ims-mongo-1",
  redis: "inveniops-ims-redis-1",
} as const;

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", [...args]);
  return stdout.trim();
}

export async function pause(container: string): Promise<void> {
  await docker(["pause", container]);
}

export async function unpause(container: string): Promise<void> {
  await docker(["unpause", container]);
}

/** SIGTERM, waits up to `timeoutSeconds` for a clean exit before SIGKILL — the same signal path a real orchestrator sends on a graceful redeploy. */
export async function stop(container: string, timeoutSeconds = 10): Promise<void> {
  await docker(["stop", "--time", String(timeoutSeconds), container]);
}

export async function start(container: string): Promise<void> {
  await docker(["start", container]);
}

/** SIGKILL immediately — no chance for the process to run its own shutdown hooks. Use this for "crash," stop() for "graceful shutdown." */
export async function kill(
  container: string,
  signal: "SIGKILL" | "SIGTERM" = "SIGKILL",
): Promise<void> {
  await docker(["kill", "--signal", signal, container]);
}

export async function isRunning(container: string): Promise<boolean> {
  try {
    const out = await docker(["inspect", "-f", "{{.State.Running}}", container]);
    return out === "true";
  } catch {
    return false;
  }
}

/** Logs emitted at or after `sinceIso` — used to assert on specific log lines (e.g. retry/backoff) a chaos scenario should have produced. */
export async function logsSince(container: string, sinceIso: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["logs", container, "--since", sinceIso], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export interface ContainerStatsSnapshot {
  readonly memUsedBytes: number | null;
  readonly cpuPercent: number | null;
}

const UNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  b: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
};

function parseSize(token: string): number | null {
  const match = token.trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) return null;
  const multiplier = UNIT_MULTIPLIERS[match[2]!.toLowerCase()];
  return multiplier === undefined ? null : Number(match[1]) * multiplier;
}

export async function statsSnapshot(container: string): Promise<ContainerStatsSnapshot> {
  const out = await docker(["stats", "--no-stream", "--format", "{{json .}}", container]);
  const parsed = JSON.parse(out) as { MemUsage?: string; CPUPerc?: string };
  const [used] = String(parsed.MemUsage ?? "").split("/");
  return {
    memUsedBytes: used ? parseSize(used) : null,
    cpuPercent: parsed.CPUPerc ? Number(parsed.CPUPerc.replace("%", "")) : null,
  };
}

/** Restores a container to a known-good running state regardless of how it got disrupted (paused, stopped, killed) — the one function every test's cleanup should call. */
export async function ensureRunning(container: string): Promise<void> {
  const running = await isRunning(container);
  if (running) {
    // Might be paused-but-"running" by Docker's own bookkeeping — unpause
    // is a no-op if it wasn't paused.
    try {
      await unpause(container);
    } catch {
      // wasn't paused — fine
    }
    return;
  }
  await start(container);
}

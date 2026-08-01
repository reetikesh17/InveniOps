// Backend process memory high-water mark, sourced from `docker stats`
// (real OS-level RSS as Docker reports it) rather than anything the Node
// process reports about itself — deliberately external, so an in-process
// measurement approach can't be blind to the exact kind of memory pressure
// a load test is trying to surface.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const UNIT_MULTIPLIERS = {
  b: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
};

/** Parses a docker-stats size token like "45.2MiB" into bytes. */
function parseSize(token) {
  const match = token.trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) {
    return null;
  }
  const [, numStr, unitRaw] = match;
  const multiplier = UNIT_MULTIPLIERS[unitRaw.toLowerCase()];
  if (multiplier === undefined) {
    return null;
  }
  return Number(numStr) * multiplier;
}

/** One-shot snapshot: { memUsedBytes, memLimitBytes, cpuPercent } or null if the container isn't running / docker isn't reachable. */
export async function snapshotContainerStats(containerName) {
  try {
    const { stdout } = await execFileAsync("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      containerName,
    ]);
    const parsed = JSON.parse(stdout.trim());
    const [usedToken, limitToken] = String(parsed.MemUsage || "")
      .split("/")
      .map((s) => s.trim());
    return {
      memUsedBytes: usedToken ? parseSize(usedToken) : null,
      memLimitBytes: limitToken ? parseSize(limitToken) : null,
      cpuPercent: parsed.CPUPerc ? Number(parsed.CPUPerc.replace("%", "")) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Polls docker stats for `containerName` and tracks the peak memUsedBytes
 * seen — the actual deliverable ("memory high-water mark"). Every sample
 * is also handed to onSample for the raw time series.
 */
export function startMemoryPoller(containerName, intervalMs, onSample) {
  let stopped = false;
  let timer = null;
  let peakBytes = 0;
  const startedAtMs = Date.now();

  const tick = async () => {
    if (stopped) {
      return;
    }
    const snapshot = await snapshotContainerStats(containerName);
    if (snapshot && snapshot.memUsedBytes !== null) {
      peakBytes = Math.max(peakBytes, snapshot.memUsedBytes);
    }
    onSample({ atMs: Date.now(), elapsedMs: Date.now() - startedAtMs, ...snapshot });
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, 0);

  return {
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
    getPeakBytes: () => peakBytes,
  };
}

#!/usr/bin/env node
// Entry point: `node orchestrator/run.js --scenario <name> [--key value ...]`
// Wires together everything k6 can't see on its own (see ../README.md for
// full methodology): launches k6 in Docker on the compose network, samples
// /metrics + docker stats + Mongo throughout, waits for the pipeline to
// drain, diffs before/after, and writes one JSON report + console summary.
import { readFileSync, mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoSampler } from "./mongoSample.js";
import { startBackendPoller } from "./backendPoller.js";
import { startMemoryPoller } from "./dockerStats.js";
import { scrapeMetrics, computeMetricsDiff } from "./metrics.js";
import { buildReport, renderConsoleSummary, summarizePerSignalSamples, mergeK6Summaries } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADTEST_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(LOADTEST_ROOT, "..", "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { overrides: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenario") {
      args.scenario = argv[(i += 1)];
    } else if (arg === "--min-persisted-per-sec") {
      // A regression gate, not a scenario parameter — kept out of
      // `overrides` (which get merged into the k6 scenario config) so it
      // can't accidentally leak into TARGET_RATE/DURATION_S/etc.
      args.minPersistedPerSec = Number(argv[(i += 1)]);
    } else if (arg.startsWith("--")) {
      args.overrides[arg.slice(2)] = argv[(i += 1)];
    }
  }
  return args;
}

async function waitForHealth(targetUrl) {
  const res = await fetch(`${targetUrl}/health`);
  if (!res.ok) {
    throw new Error(`GET /health returned ${res.status} — is the stack up? (docker compose up -d)`);
  }
  const body = await res.json();
  if (body.status !== "healthy") {
    throw new Error(`Backend reports unhealthy before the test even started: ${JSON.stringify(body)}`);
  }
}

/** Maps this scenario's merged config onto the exact env var names k6/loadtest.js reads — the one place that mapping lives. */
function buildScenarioEnv(scenario, cfg) {
  switch (scenario) {
    case "sustained-ramp":
      return {
        TARGET_RATE: String(cfg.targetRate),
        RAMP_UP_S: `${cfg.rampUpS}s`,
        HOLD_S: `${cfg.holdS}s`,
        RAMP_DOWN_S: `${cfg.rampDownS}s`,
      };
    case "burst-recovery":
      return {
        BASELINE_RATE: String(cfg.baselineRate),
        SPIKE_RATE: String(cfg.spikeRate),
        BASELINE_S: `${cfg.baselineS}s`,
        SPIKE_S: `${cfg.spikeS}s`,
        RECOVERY_S: `${cfg.recoveryS}s`,
      };
    case "mixed-components":
    case "debounce-concentrated":
    case "debounce-spread":
      return {
        RATE: String(cfg.rate),
        DURATION_S: `${cfg.durationS}s`,
      };
    default:
      throw new Error(`unknown scenario "${scenario}"`);
  }
}

/** Rough wall-clock budget so the settle-wait loop and any progress logging has a sane upper bound to reason about. */
function estimateDurationSec(scenario, cfg) {
  switch (scenario) {
    case "sustained-ramp":
      return cfg.rampUpS + cfg.holdS + cfg.rampDownS;
    case "burst-recovery":
      return cfg.baselineS + 1 + cfg.spikeS + 1 + cfg.recoveryS;
    default:
      return cfg.durationS;
  }
}

/**
 * Launches one k6 shard. Its own container = its own Docker-bridge IP —
 * see SHARDING comment in k6/loadtest.js for why this matters (the
 * backend's per-IP rate limiter would otherwise cap a single-container
 * generator at a small fraction of any interesting scenario rate). stdio
 * goes to a per-shard log file, not inherited — with shardCount often in
 * the double digits, interleaved k6 progress bars on one terminal would be
 * unreadable.
 */
function runK6Shard(shardIndex, env, network, k6Dir, outDir) {
  return new Promise((resolve, reject) => {
    const dockerArgs = [
      "run",
      "--rm",
      "--network",
      network,
      "-v",
      `${k6Dir}:/scripts:ro`,
      "-v",
      `${outDir}:/out`,
      ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      "grafana/k6",
      "run",
      "--summary-export",
      `/out/k6-summary-${shardIndex}.json`,
      "/scripts/loadtest.js",
    ];
    const logStream = createWriteStream(path.join(outDir, `k6-shard-${shardIndex}.log`));
    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on("exit", (code) => resolve(code));
    child.on("error", reject);
  });
}

/** Runs shardCount k6 containers in parallel, each a distinct SHARD_INDEX, all otherwise sharing baseEnv. */
async function runK6Shards(shardCount, baseEnv, network, k6Dir, outDir) {
  console.log(`Launching ${shardCount} k6 shard container(s) in parallel (log per shard: k6-shard-<i>.log)...`);
  const exitCodes = await Promise.all(
    Array.from({ length: shardCount }, (_, i) =>
      runK6Shard(i, { ...baseEnv, SHARD_COUNT: String(shardCount), SHARD_INDEX: String(i) }, network, k6Dir, outDir),
    ),
  );
  console.log(`All shards exited: [${exitCodes.join(", ")}]`);
  return exitCodes;
}

async function waitForDrain(backendPoller, settleTimeoutMs, pollIntervalMs, quietChecksNeeded) {
  const deadline = Date.now() + settleTimeoutMs;
  let consecutiveQuiet = 0;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const latest = backendPoller.getLatest();
    if (latest && latest.queueDepth === 0) {
      consecutiveQuiet += 1;
      if (consecutiveQuiet >= quietChecksNeeded) {
        return { drained: true, waitedMs: settleTimeoutMs - (deadline - Date.now()) };
      }
    } else {
      consecutiveQuiet = 0;
    }
  }
  return { drained: false, waitedMs: settleTimeoutMs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scenario) {
    console.error("Usage: node orchestrator/run.js --scenario <name> [--key value ...]");
    console.error("Scenarios: sustained-ramp, burst-recovery, mixed-components, debounce-concentrated, debounce-spread");
    process.exit(1);
  }

  const globalConfig = JSON.parse(readFileSync(path.join(LOADTEST_ROOT, "configs", "scenarios.json"), "utf8"));
  const scenarioDefaults = globalConfig.scenarios[args.scenario];
  if (!scenarioDefaults) {
    console.error(`Unknown scenario "${args.scenario}". Known: ${Object.keys(globalConfig.scenarios).join(", ")}`);
    process.exit(1);
  }

  const numericOverrides = Object.fromEntries(
    Object.entries(args.overrides).map(([k, v]) => [k, Number.isNaN(Number(v)) ? v : Number(v)]),
  );
  const scenarioConfig = { ...scenarioDefaults, ...numericOverrides };
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const estimatedSec = estimateDurationSec(args.scenario, scenarioConfig);

  console.log(`InveniOps load test — scenario=${args.scenario} runId=${runId}`);
  console.log(`Config: ${JSON.stringify(scenarioConfig)}`);
  console.log(`Estimated k6 run time: ~${estimatedSec}s (plus settle time after)`);

  await waitForHealth(globalConfig.targetUrl);
  console.log("Backend healthy. Proceeding.");

  const outDir = path.join(REPO_ROOT, "docs", "loadtest-results", runId);
  mkdirSync(outDir, { recursive: true });

  const mongoSampler = new MongoSampler(globalConfig.mongoUri, globalConfig.mongoDb);
  await mongoSampler.connect();

  const preExisting = await mongoSampler.countPersisted(runId);
  if (preExisting > 0) {
    console.warn(`WARNING: ${preExisting} documents already match runId prefix before the test started (unexpected).`);
  }

  const metricsBefore = await scrapeMetrics(globalConfig.targetUrl);

  const persistedTimeSeries = [];
  const stopPersistedPoller = mongoSampler.startPersistedCountPoller(runId, globalConfig.pollIntervalMs, (sample) => {
    persistedTimeSeries.push(sample);
  });
  const latencyPoller = mongoSampler.startLatencySamplePoller(runId, globalConfig.pollIntervalMs);
  const backendSamples = [];
  const backendPoller = startBackendPoller(globalConfig.targetUrl, globalConfig.pollIntervalMs, (sample) => {
    backendSamples.push(sample);
  });
  const memorySamples = [];
  const memoryPoller = startMemoryPoller(globalConfig.backendContainer, globalConfig.pollIntervalMs, (sample) => {
    memorySamples.push(sample);
  });

  const startedAt = new Date().toISOString();

  const k6Env = {
    RUN_ID: runId,
    SCENARIO: args.scenario,
    TARGET_URL: globalConfig.k6TargetUrl,
    COMPONENT_COUNT: String(scenarioConfig.componentCount),
    SAMPLE_RATE: String(globalConfig.sampleRate),
    ...buildScenarioEnv(args.scenario, scenarioConfig),
  };

  const shardCount = Math.max(1, Number(scenarioConfig.shardCount ?? globalConfig.shardCount ?? 1));
  let exitCodes = [];
  const warnings = [];
  try {
    exitCodes = await runK6Shards(shardCount, k6Env, globalConfig.dockerNetwork, path.join(LOADTEST_ROOT, "k6"), outDir);
  } catch (error) {
    warnings.push(`k6 launch failed: ${error}`);
  }
  const failedShards = exitCodes.filter((c) => c !== 0).length;
  if (failedShards > 0) {
    warnings.push(`${failedShards}/${shardCount} k6 shard(s) exited non-zero — check k6-shard-<i>.log in the output dir.`);
  }

  console.log("Waiting for the pipeline to drain (queue depth -> 0) before taking the final snapshot...");
  const drainResult = await waitForDrain(
    backendPoller,
    globalConfig.settleTimeoutMs,
    globalConfig.pollIntervalMs,
    globalConfig.settleQuietChecks,
  );
  if (!drainResult.drained) {
    warnings.push(
      `Queue did not reach depth 0 within the ${globalConfig.settleTimeoutMs}ms settle timeout — persisted count and e2e latency below reflect an incomplete drain, not the eventual steady state.`,
    );
  }

  const endedAt = new Date().toISOString();

  await stopPersistedPoller();
  await latencyPoller.stop();
  await backendPoller.stop();
  await memoryPoller.stop();

  const metricsAfter = await scrapeMetrics(globalConfig.targetUrl);
  const metricsDiff = computeMetricsDiff(metricsBefore, metricsAfter);

  const persistedTotal = await mongoSampler.countPersisted(runId);
  const perSignalSamples = latencyPoller.getSamples();
  const perSignalLatency = summarizePerSignalSamples(perSignalSamples);
  if (perSignalLatency.sampleSize < 20) {
    warnings.push(
      `Per-signal latency sample size was only ${perSignalLatency.sampleSize} — treat that percentile breakdown as indicative, not precise. Raise SAMPLE_RATE in configs/scenarios.json for a tighter estimate.`,
    );
  }

  const shardSummaries = [];
  for (let i = 0; i < shardCount; i += 1) {
    try {
      shardSummaries.push(JSON.parse(readFileSync(path.join(outDir, `k6-summary-${i}.json`), "utf8")));
    } catch (error) {
      warnings.push(`Could not read shard ${i}'s k6 summary export: ${error}`);
    }
  }
  const k6Summary = shardSummaries.length > 0 ? mergeK6Summaries(shardSummaries) : null;
  if (shardCount > 1 && k6Summary) {
    warnings.push(
      `edge.latencyMs is merged across ${shardCount} shards: avg/p50/p95 are averaged (approximate), p99/max are the worst observed across shards (not averaged away). See k6Summary.note in the raw shard files for detail.`,
    );
  }

  const resourcePeaks = {
    ...backendPoller.getPeaks(),
    peakBackendMemoryBytes: memoryPoller.getPeakBytes(),
  };

  await mongoSampler.close();

  let dockerInfo = {};
  try {
    const { execFileSync } = await import("node:child_process");
    const raw = execFileSync("docker", ["info", "--format", "{{.NCPU}} {{.MemTotal}}"]).toString().trim();
    const [ncpu, memTotal] = raw.split(" ");
    dockerInfo = { dockerCpus: Number(ncpu), dockerMemTotalBytes: Number(memTotal) };
  } catch {
    // best-effort context only
  }

  const report = buildReport({
    runId,
    scenario: args.scenario,
    config: {
      ...scenarioConfig,
      shardCount,
      sampleRate: globalConfig.sampleRate,
      pollIntervalMs: globalConfig.pollIntervalMs,
    },
    environment: {
      ...dockerInfo,
      backendContainer: globalConfig.backendContainer,
      note: "Load generator (k6) and the system under test share this single machine's CPU/memory — this is a local baseline, not an isolated-generator measurement. See README.md.",
    },
    startedAt,
    endedAt,
    k6Summary,
    metricsBefore,
    metricsDiff,
    persistedTotal,
    persistedTimeSeries,
    perSignalLatency,
    resourcePeaks,
    warnings,
  });

  writeFileSync(path.join(outDir, "result.json"), JSON.stringify(report, null, 2));
  const consoleSummary = renderConsoleSummary(report);
  writeFileSync(path.join(outDir, "summary.txt"), consoleSummary);
  writeFileSync(
    path.join(outDir, "raw-samples.json"),
    JSON.stringify({ backendSamples, memorySamples, perSignalSamples }, null, 2),
  );

  console.log(`\n${consoleSummary}\n`);
  console.log(`Full report: ${path.join(outDir, "result.json")}`);

  // Regression gate for CI (see .github/workflows/ci.yml and
  // docs/performance.md for the documented floor and why it's set well
  // below the local-machine baseline): checked against PERSISTED/sec, not
  // accepted/sec — accepted only means "the buffer took it," persisted
  // means it actually made it through the whole pipeline, which is the
  // property a throughput regression would actually break.
  if (args.minPersistedPerSec !== undefined) {
    const achieved = report.persistence.persistedPerSec;
    if (achieved < args.minPersistedPerSec) {
      console.error(
        `\nFAIL: persisted/sec ${achieved.toFixed(1)} is below the required floor of ${args.minPersistedPerSec}/s — see ${path.join(outDir, "summary.txt")}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`Throughput floor check passed: ${achieved.toFixed(1)}/s >= ${args.minPersistedPerSec}/s floor.`);
    }
  }
}

main().catch((error) => {
  console.error("Load test failed:", error);
  process.exit(1);
});

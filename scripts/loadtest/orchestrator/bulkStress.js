#!/usr/bin/env node
// Diagnostic tool, not part of the regression-gated suite: every k6
// scenario in configs/scenarios.json is bound by the real per-IP rate
// limiter (~90-100 accepted/sec observed, even sharded across 5 source
// IPs — see docs/loadtest-results/), which means none of them ever
// pressure-test the actual ingestion PIPELINE (buffer -> BullMQ ->
// debouncer -> Mongo/Postgres) — buffer fill stayed at 0% and queue depth
// stayed under 10 in every recorded run. This script exists to answer a
// different question: with the rate limiter out of the way, where does
// the pipeline itself actually saturate?
//
// It does that by hammering POST /api/v1/signals/bulk-test — an
// in-process synthetic-signal generator that deliberately bypasses the
// token bucket (see backend/src/api/routes/signals.ts's own comment on
// why it exists), disabled outside NODE_ENV=production=false. Usage:
//   node orchestrator/bulkStress.js --durationS 20 --batchSize 2000 --concurrency 4
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { startBackendPoller } from "./backendPoller.js";
import { startMemoryPoller } from "./dockerStats.js";
import { scrapeMetrics, computeMetricsDiff } from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADTEST_ROOT = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[(i += 1)];
    }
  }
  return args;
}

async function waitForHealth(targetUrl) {
  const res = await fetch(`${targetUrl}/health`);
  const body = await res.json();
  if (body.status === "unhealthy") {
    throw new Error(
      `Backend reports unhealthy before the test even started: ${JSON.stringify(body)}`,
    );
  }
}

/** One bulk-test POST — count synthetic signals, generated and buffered in-process, no network-side generation cost. */
async function bulkTestOnce(targetUrl, count) {
  const startedAtMs = Date.now();
  const res = await fetch(`${targetUrl}/api/v1/signals/bulk-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    accepted: body.accepted ?? 0,
    dropped: body.dropped ?? 0,
    durationMs: Date.now() - startedAtMs,
  };
}

/** Keeps `concurrency` bulk-test requests in flight until `stopAtMs`. */
async function driveLoad(targetUrl, batchSize, concurrency, stopAtMs, totals) {
  async function worker() {
    while (Date.now() < stopAtMs) {
      const result = await bulkTestOnce(targetUrl, batchSize);
      totals.requests += 1;
      totals.accepted += result.accepted;
      totals.dropped += result.dropped;
      if (result.status !== 202) {
        totals.nonOkResponses += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const globalConfig = JSON.parse(
    readFileSync(path.join(LOADTEST_ROOT, "configs", "scenarios.json"), "utf8"),
  );

  const durationS = Number(args.durationS ?? 20);
  const batchSize = Number(args.batchSize ?? 2000);
  const concurrency = Number(args.concurrency ?? 4);
  const pollIntervalMs = Number(args.pollIntervalMs ?? globalConfig.pollIntervalMs ?? 1000);
  const label = args.label ?? "bulk-stress";
  // Overridable so this can target a throwaway, differently-configured
  // container (see docs/performance.md's tuning methodology — one env var
  // changed at a time, tested in isolation) without touching the shared
  // dev container every other script in this repo points at by default.
  const targetUrl = args.targetUrl ?? globalConfig.targetUrl;
  const backendContainer = args.backendContainer ?? globalConfig.backendContainer;

  await waitForHealth(targetUrl);
  console.log(
    `InveniOps pipeline stress — label=${label} target=${targetUrl} durationS=${durationS} batchSize=${batchSize} concurrency=${concurrency}`,
  );

  const mongoClient = new MongoClient(globalConfig.mongoUri);
  await mongoClient.connect();
  const signals = mongoClient.db(globalConfig.mongoDb).collection("signals");

  const testStartedAt = new Date();
  const metricsBefore = await scrapeMetrics(targetUrl);

  const backendPoller = startBackendPoller(targetUrl, pollIntervalMs, () => {});
  const memoryPoller = startMemoryPoller(backendContainer, pollIntervalMs, () => {});

  const totals = { requests: 0, accepted: 0, dropped: 0, nonOkResponses: 0 };
  const stopAtMs = Date.now() + durationS * 1000;
  const wallStart = Date.now();
  await driveLoad(targetUrl, batchSize, concurrency, stopAtMs, totals);
  const offeredWallMs = Date.now() - wallStart;
  const persistedAtOfferStop = await signals.countDocuments({
    "rawPayload.synthetic": true,
    receivedAt: { $gte: testStartedAt },
  });

  // The number that actually isolates pipeline capacity from offered-load
  // shape: once new signals stop arriving, how fast does the worker chew
  // through whatever backlog is already durably queued in BullMQ? That's
  // Mongo/Postgres/debouncer/worker-concurrency capacity, cleanly separated
  // from "how aggressively did this script happen to offer load."
  console.log(
    `Offered load finished (${offeredWallMs}ms, ${persistedAtOfferStop} persisted so far). Draining the backlog (queue depth -> 0)...`,
  );
  const drainStartMs = Date.now();
  const drainDeadline = drainStartMs + 60_000;
  let drained = false;
  let quiet = 0;
  while (Date.now() < drainDeadline) {
    await sleep(pollIntervalMs);
    const latest = backendPoller.getLatest();
    if (latest && latest.queueDepth === 0) {
      quiet += 1;
      if (quiet >= 3) {
        drained = true;
        break;
      }
    } else {
      quiet = 0;
    }
  }
  const drainDurationSec = (Date.now() - drainStartMs) / 1000;

  const persistedTotal = await signals.countDocuments({
    "rawPayload.synthetic": true,
    receivedAt: { $gte: testStartedAt },
  });
  const persistedDuringDrain = persistedTotal - persistedAtOfferStop;
  const drainPersistedPerSec = drainDurationSec > 0 ? persistedDuringDrain / drainDurationSec : 0;

  await backendPoller.stop();
  await memoryPoller.stop();
  const metricsAfter = await scrapeMetrics(targetUrl);
  const diff = computeMetricsDiff(metricsBefore, metricsAfter);
  const peaks = backendPoller.getPeaks();
  const peakMemBytes = memoryPoller.getPeakBytes();

  await mongoClient.close();

  const wallSec = offeredWallMs / 1000;
  const droppedTotalBySeverity = Object.fromEntries(
    Object.entries(diff.droppedBySeverityAndReason).map(([sev, byReason]) => [
      sev,
      Object.values(byReason).reduce((a, b) => a + b, 0),
    ]),
  );
  const totalDropped = Object.values(droppedTotalBySeverity).reduce((a, b) => a + b, 0);

  console.log(`
────────────────────────────────────────────────────────────────────────
PIPELINE STRESS — ${label}
Offered load window: ${wallSec.toFixed(1)}s, drain window: ${drainDurationSec.toFixed(1)}s, drained: ${drained}
────────────────────────────────────────────────────────────────────────
OFFERED
  bulk-test requests:     ${totals.requests}
  Signals offered:        ${totals.requests * batchSize}
  Accepted (buffered):    ${totals.accepted}  (${(totals.accepted / wallSec).toFixed(0)}/s offered-accept rate)
  Dropped by buffer:      ${totals.dropped}
  Non-202 responses:      ${totals.nonOkResponses}

DRAIN-PHASE THROUGHPUT (the headline number — isolates pipeline capacity
from offered-load shape: how fast the worker/Mongo/Postgres pipeline
processes an already-queued backlog once new signals stop arriving)
  Persisted during drain: ${persistedDuringDrain}
  Drain-phase persisted/sec: ${drainPersistedPerSec.toFixed(1)}

PERSISTED (whole run, offer + drain combined)
  Persisted to Mongo:     ${persistedTotal}
  Persisted/sec (blended):${(persistedTotal / (wallSec + drainDurationSec)).toFixed(1)}

BACKEND'S OWN COUNTERS (received -> accepted -> dropped, by severity)
  Dropped by severity:    ${JSON.stringify(droppedTotalBySeverity)}
  Total dropped:          ${totalDropped}
  Jobs processed/failed:  ${diff.jobsProcessed} / ${diff.jobsFailed}
  E2E latency (job level, receipt->persisted): p50 ${diff.e2eHistogram.p50Ms}ms  p95 ${diff.e2eHistogram.p95Ms}ms  p99 ${diff.e2eHistogram.p99Ms}ms  (n=${diff.e2eHistogram.count})

RESOURCE PEAKS DURING THE RUN
  Peak buffer fill:       ${(peaks.peakBufferFillRatio * 100).toFixed(1)}%
  Peak queue depth:       ${peaks.peakQueueDepth}
  Peak DLQ size:          ${peaks.peakDlqSize}
  Peak backend memory:    ${(peakMemBytes / 1024 / 1024).toFixed(1)} MiB
────────────────────────────────────────────────────────────────────────
`);
}

main().catch((error) => {
  console.error("Pipeline stress failed:", error);
  process.exit(1);
});

// InveniOps ingestion load test — driven entirely by env vars so the
// orchestrator (../orchestrator/run.js) is the single source of truth for
// scenario parameters (see ../configs/scenarios.json). Run directly with
// `k6 run` only for manual debugging of one scenario; for a real,
// measured run use the orchestrator, which also captures everything k6
// itself can't see (persisted-to-Mongo counts, buffer/queue peaks, memory).
import http from "k6/http";
import { Counter } from "k6/metrics";
import { buildSignal, DEFAULT_SEVERITY_MIX } from "./lib/payload.js";

const TARGET_URL = __ENV.TARGET_URL || "http://backend:3000";
const RUN_ID = __ENV.RUN_ID;
const SCENARIO = __ENV.SCENARIO;
if (!RUN_ID || !SCENARIO) {
  throw new Error("RUN_ID and SCENARIO env vars are required");
}

const COMPONENT_COUNT = Number(__ENV.COMPONENT_COUNT || 300);
const SEVERITY_MIX = __ENV.SEVERITY_MIX ? JSON.parse(__ENV.SEVERITY_MIX) : DEFAULT_SEVERITY_MIX;
const SAMPLE_RATE = Number(__ENV.SAMPLE_RATE || 0.01);

// SHARDING: the backend rate-limits per source IP (RATE_LIMIT_IP_CAPACITY/
// _REFILL_PER_SECOND — much stricter than the global limit), and every VU
// inside one k6 container shares that container's one Docker-bridge IP. A
// single-container generator therefore hits the per-IP ceiling almost
// immediately, regardless of how much headroom the buffer/queue actually
// have — that's the GENERATOR looking like one client, not a property of
// the traffic a real fleet of distributed signal producers would create.
// The orchestrator (run.js) launches SHARD_COUNT parallel k6 containers —
// each gets its own bridge IP — and splits the target rate across them;
// this script divides its own configured rate by SHARD_COUNT accordingly.
// SHARD_INDEX only affects signalId uniqueness (see lib/payload.js), not
// behavior.
const SHARD_COUNT = Math.max(1, Number(__ENV.SHARD_COUNT || 1));
const SHARD_INDEX = Number(__ENV.SHARD_INDEX || 0);

function perShard(rate) {
  return Math.max(1, Math.round(rate / SHARD_COUNT));
}

// Custom counters, classified from the actual response — not k6's default
// pass/fail (429/503 are valid, expected outcomes here, not test failures).
const accepted202 = new Counter("signals_accepted_202");
const rateLimited429 = new Counter("signals_rate_limited_429");
const bufferSaturated503 = new Counter("signals_buffer_saturated_503");
const otherStatus = new Counter("signals_other_status");
const requestErrors = new Counter("signals_request_errors");
const sampledSent = new Counter("signals_sampled_sent");

// preAllocatedVUs/maxVUs sized off Little's Law (concurrent VUs needed ≈
// rate × latency) against this backend's OBSERVED healthy latency
// (single-digit ms) — deliberately NOT padded with a large multiplier.
// This is a real machine running `shardCount` of these in parallel
// alongside the whole stack (see README's resource-contention finding: 20
// shards at a 4x/generous budget exhausted Docker Desktop's allocation and
// produced 88% connection failures that were the GENERATOR falling over,
// not the backend). If the backend genuinely can't keep up, the honest
// signal is dropped_iterations climbing — that's real, reportable
// backpressure, not something to paper over with a bigger VU pool. If
// dropped_iterations shows up at a rate that's otherwise clean (no
// request_errors, backend metrics show headroom), that's the cue to raise
// this budget a little, not blow it out again.
function vuBudget(peakRate) {
  return {
    preAllocatedVUs: Math.min(500, Math.ceil(peakRate * 0.2) + 10),
    maxVUs: Math.min(1500, Math.ceil(peakRate * 0.6) + 50),
  };
}

function buildScenarioOptions() {
  switch (SCENARIO) {
    case "sustained-ramp": {
      const target = perShard(Number(__ENV.TARGET_RATE || 3000));
      const rampUp = __ENV.RAMP_UP_S || "30s";
      const hold = __ENV.HOLD_S || "60s";
      const rampDown = __ENV.RAMP_DOWN_S || "15s";
      return {
        scenarios: {
          sustained_ramp: {
            executor: "ramping-arrival-rate",
            startRate: 0,
            timeUnit: "1s",
            ...vuBudget(target),
            stages: [
              { target, duration: rampUp },
              { target, duration: hold },
              { target: 0, duration: rampDown },
            ],
          },
        },
      };
    }
    case "burst-recovery": {
      const baseline = perShard(Number(__ENV.BASELINE_RATE || 500));
      const spike = perShard(Number(__ENV.SPIKE_RATE || 12000));
      const baselineS = __ENV.BASELINE_S || "20s";
      const spikeS = __ENV.SPIKE_S || "10s";
      const recoveryS = __ENV.RECOVERY_S || "30s";
      return {
        scenarios: {
          burst_recovery: {
            executor: "ramping-arrival-rate",
            startRate: baseline,
            timeUnit: "1s",
            ...vuBudget(spike),
            stages: [
              { target: baseline, duration: baselineS },
              // Deliberately a hard step, not a ramp — a burst is sudden by
              // definition; ramping into it would be testing something else.
              { target: spike, duration: "1s" },
              { target: spike, duration: spikeS },
              { target: baseline, duration: "1s" },
              { target: baseline, duration: recoveryS },
            ],
          },
        },
      };
    }
    case "mixed-components": {
      const rate = perShard(Number(__ENV.RATE || 1500));
      const durationS = __ENV.DURATION_S || "45s";
      return {
        scenarios: {
          mixed_components: {
            executor: "constant-arrival-rate",
            rate,
            timeUnit: "1s",
            duration: durationS,
            ...vuBudget(rate),
          },
        },
      };
    }
    case "debounce-concentrated":
    case "debounce-spread": {
      const rate = perShard(Number(__ENV.RATE || 1500));
      const durationS = __ENV.DURATION_S || "30s";
      return {
        scenarios: {
          [SCENARIO.replace(/-/g, "_")]: {
            executor: "constant-arrival-rate",
            rate,
            timeUnit: "1s",
            duration: durationS,
            ...vuBudget(rate),
          },
        },
      };
    }
    default:
      throw new Error(`unknown SCENARIO: ${SCENARIO}`);
  }
}

export const options = {
  ...buildScenarioOptions(),
  // p99 isn't in k6's default summary set — explicit here so the console
  // summary and --summary-export both carry it without the orchestrator
  // having to recompute percentiles itself from raw samples.
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(95)", "p(99)"],
};

export default function run() {
  const { signalId, sampled, body } = buildSignal({
    runId: RUN_ID,
    scenario: SCENARIO,
    shard: SHARD_INDEX,
    componentCount: COMPONENT_COUNT,
    severityMix: SEVERITY_MIX,
    vu: __VU,
    iter: __ITER,
    sampleRate: SAMPLE_RATE,
  });

  if (sampled) {
    sampledSent.add(1);
  }

  const res = http.post(`${TARGET_URL}/api/v1/signals`, JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    timeout: "10s",
    // Without this, k6 treats any non-2xx/3xx status as an "error" by
    // default (a synthetic error_code like 1429 for a 429) — which is
    // exactly wrong here, since 429/503/400 are legitimate, expected
    // outcomes this script classifies itself via res.status below, not
    // generator/transport failures. This keeps k6's own http_req_failed
    // metric (and error_code) reserved for genuine transport failures.
    responseCallback: http.expectedStatuses(200, 201, 202, 400, 429, 503),
  });

  // res.status is 0 only when no HTTP response was received at all
  // (connection refused, timeout, DNS failure) — a real generator/network
  // problem, distinct from any actual HTTP response including 4xx/5xx.
  if (res.status === 0) {
    requestErrors.add(1);
    if (__ENV.DEBUG_ERRORS) {
      console.warn(`request error: ${res.error}`);
    }
    return;
  }

  switch (res.status) {
    case 202:
      accepted202.add(1);
      break;
    case 429:
      rateLimited429.add(1);
      break;
    case 503:
      bufferSaturated503.add(1);
      break;
    default:
      otherStatus.add(1);
      break;
  }
  // signalId is intentionally unused here beyond generation — it travels
  // in the request body, and the orchestrator finds it later by querying
  // Mongo for this run's signalId prefix, not by anything logged here.
  void signalId;
}

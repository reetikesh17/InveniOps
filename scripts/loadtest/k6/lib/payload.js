// Shared by every scenario in loadtest.js — the ONE place severity mix,
// component-type spread, and componentId pooling are decided, so scenarios
// can never quietly diverge in how they generate traffic. Only the arrival
// rate and pool size differ per scenario; this file is deliberately
// data-only (no k6/http here) so it stays trivially unit-testable outside
// k6 if that's ever wanted.

export const COMPONENT_TYPES = ["API", "MCP_HOST", "CACHE", "QUEUE", "RDBMS", "NOSQL"];

// Not uniform P0 — modal at P2/P3, matching a real system where most
// signals are noise and P0s are the rare, actually-urgent case. Override
// via the SEVERITY_MIX env var (JSON: {"P0":0.05,"P1":0.15,"P2":0.35,"P3":0.45}).
export const DEFAULT_SEVERITY_MIX = { P0: 0.05, P1: 0.15, P2: 0.35, P3: 0.45 };

/** Weighted pick from a {key: weight} map. Weights need not sum to 1 — normalized internally. */
export function weightedPick(mix, rng = Math.random) {
  const entries = Object.entries(mix);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      return key;
    }
  }
  return entries[entries.length - 1][0];
}

/**
 * Deterministic-by-index component assignment, computed algorithmically
 * (no materialized pool array — this runs per-iteration inside every VU, and
 * VUs at high arrival rates number in the thousands, so no per-VU array
 * duplication). `componentCount` components spread evenly across the 6
 * types: index 0..componentCount-1 maps to
 * `${TYPES[index % 6]}_${floor(index / 6)}`.
 */
export function pickComponent(componentCount, rng = Math.random) {
  const index = Math.floor(rng() * componentCount);
  const componentType = COMPONENT_TYPES[index % COMPONENT_TYPES.length];
  const slot = Math.floor(index / COMPONENT_TYPES.length);
  return { componentType, componentId: `${componentType}_${slot}` };
}

/**
 * signalId encodes everything the orchestrator needs to isolate this run's
 * data from whatever else is in Mongo, without touching the schema:
 *   lt-<runId>-<S|N>-<scenario>-<shard>-<vu>-<iter>-<rand>
 * The sampled/not-sampled flag sits immediately after runId (not after
 * scenario, which itself contains hyphens — e.g. "debounce-concentrated" —
 * and would make an unambiguous prefix regex impossible) so the
 * orchestrator can cleanly match `^lt-<runId>-` for "every signal this run
 * produced" and `^lt-<runId>-S-` for "the latency-sample subset" — see
 * orchestrator/mongoSample.js. `shard` distinguishes the parallel k6
 * containers used to simulate multiple source IPs (see SHARDING in
 * loadtest.js) — without it, two shards' independently-numbered VUs could
 * collide on (vu, iter). `rand` is just a human-readability nicety on top,
 * not load-bearing for uniqueness.
 */
export function buildSignalId(runId, scenario, shard, vu, iter, sampled) {
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  const flag = sampled ? "S" : "N";
  return `lt-${runId}-${flag}-${scenario}-${shard}-${vu}-${iter}-${rand}`;
}

/**
 * One full signal payload, ready to JSON.stringify into the POST body.
 * `sentAtMs` is embedded in rawPayload (not just logged) so the persisted
 * Mongo document itself carries its own send time — the orchestrator's
 * latency cross-check reads it straight back off the document, no
 * separate correlation log to parse or clock to reconcile beyond
 * container-vs-host, which Docker Desktop keeps in sync.
 */
export function buildSignal({
  runId,
  scenario,
  shard,
  componentCount,
  severityMix,
  vu,
  iter,
  sampleRate,
}) {
  const sampled = sampleRate > 0 && Math.random() < sampleRate;
  const { componentType, componentId } = pickComponent(componentCount);
  const severity = weightedPick(severityMix);
  const sentAtMs = Date.now();
  const signalId = buildSignalId(runId, scenario, shard, vu, iter, sampled);

  return {
    sampled,
    signalId,
    body: {
      signalId,
      componentId,
      componentType,
      severity,
      occurredAt: new Date(sentAtMs).toISOString(),
      rawPayload: {
        loadtest: true,
        runId,
        scenario,
        sentAtMs,
        message: `synthetic ${severity} signal from ${componentId}`,
      },
    },
  };
}

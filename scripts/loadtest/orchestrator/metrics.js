// Minimal Prometheus text-exposition parser for GET /metrics
// (backend/src/api/routes/metrics.ts renders it) — no client library
// dependency, just enough to parse this backend's own known format:
// `name{k="v",...} value` samples plus the `_bucket{le="..."}`/`_sum`/`_count`
// histogram convention.

/** @returns {Array<{name: string, labels: Record<string,string>, value: number}>} */
export function parsePrometheusText(text) {
  const samples = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([^\s]+)\s*$/);
    if (!match) {
      continue;
    }
    const [, name, , labelStr, valueStr] = match;
    const labels = {};
    if (labelStr) {
      const pairRegex = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
      let pairMatch;
      while ((pairMatch = pairRegex.exec(labelStr)) !== null) {
        labels[pairMatch[1]] = pairMatch[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    const value = valueStr === "+Inf" ? Infinity : valueStr === "-Inf" ? -Infinity : Number(valueStr);
    if (Number.isNaN(value)) {
      continue;
    }
    samples.push({ name, labels, value });
  }
  return samples;
}

export async function scrapeMetrics(baseUrl) {
  const res = await fetch(`${baseUrl}/metrics`);
  if (!res.ok) {
    throw new Error(`GET /metrics failed: ${res.status}`);
  }
  const text = await res.text();
  return parsePrometheusText(text);
}

function matches(sample, name, labelFilter) {
  if (sample.name !== name) {
    return false;
  }
  return Object.entries(labelFilter).every(([k, v]) => sample.labels[k] === v);
}

export function findValue(samples, name, labelFilter = {}) {
  const found = samples.find((s) => matches(s, name, labelFilter));
  return found ? found.value : 0;
}

export function sumValues(samples, name, labelFilter = {}) {
  return samples.filter((s) => matches(s, name, labelFilter)).reduce((sum, s) => sum + s.value, 0);
}

/** after-value minus before-value for one counter/gauge sample. */
export function diffValue(before, after, name, labelFilter = {}) {
  return findValue(after, name, labelFilter) - findValue(before, name, labelFilter);
}

/**
 * Diffs a cumulative "le" histogram between two scrapes. Each bucket's
 * cumulative count is itself a running total, so (after - before) per
 * bucket boundary is a valid cumulative histogram for exactly the
 * observations recorded in between — not an approximation, an exact
 * consequence of how cumulative counters work. What IS approximate: the
 * percentile reader below returns the boundary of the bucket a percentile
 * rank falls into (these buckets are fixed-width, not exact
 * interpolation), so treat e.g. "p95 ≈ 250ms" as "between the previous
 * boundary and 250ms," not a precise value.
 */
export function diffHistogram(before, after, name, boundariesMs) {
  const boundaries = [...boundariesMs, Infinity];
  const buckets = boundaries.map((le) => {
    const leLabel = le === Infinity ? "+Inf" : String(le);
    const cumulativeInWindow =
      findValue(after, `${name}_bucket`, { le: leLabel }) - findValue(before, `${name}_bucket`, { le: leLabel });
    return { le, cumulativeInWindow: Math.max(0, cumulativeInWindow) };
  });
  const count = diffValue(before, after, `${name}_count`);
  const sum = diffValue(before, after, `${name}_sum`);
  return { buckets, count: Math.max(0, count), sum: Math.max(0, sum) };
}

/** Approximate percentile (upper bucket boundary) from a diffed histogram. Returns null if no observations. */
export function histogramPercentile(diffedHistogram, p) {
  const { buckets, count } = diffedHistogram;
  if (count <= 0) {
    return null;
  }
  const target = p * count;
  for (const bucket of buckets) {
    if (bucket.cumulativeInWindow >= target) {
      return bucket.le === Infinity ? null : bucket.le;
    }
  }
  return null;
}

const SEVERITIES = ["P0", "P1", "P2", "P3"];
const DROP_REASONS = ["shed_ceiling", "hard_capacity", "sink_failure"];
export const E2E_LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/** The full before/after diff report.js needs — one place so run.js doesn't hand-assemble label lookups. */
export function computeMetricsDiff(before, after) {
  const receivedBySeverity = {};
  const acceptedBySeverity = {};
  const droppedBySeverityAndReason = {};
  for (const severity of SEVERITIES) {
    receivedBySeverity[severity] = diffValue(before, after, "ims_signals_received_total", { severity });
    acceptedBySeverity[severity] = diffValue(before, after, "ims_signals_accepted_total", { severity });
    droppedBySeverityAndReason[severity] = {};
    for (const reason of DROP_REASONS) {
      droppedBySeverityAndReason[severity][reason] = diffValue(before, after, "ims_signals_dropped_total", {
        severity,
        reason,
      });
    }
  }

  const jobsProcessed = diffValue(before, after, "ims_queue_jobs_total", { outcome: "processed" });
  const jobsFailed = diffValue(before, after, "ims_queue_jobs_total", { outcome: "failed" });

  const e2eDiffed = diffHistogram(before, after, "ims_signal_e2e_latency_ms", E2E_LATENCY_BUCKETS_MS);
  const e2eHistogram = {
    p50Ms: histogramPercentile(e2eDiffed, 0.5),
    p95Ms: histogramPercentile(e2eDiffed, 0.95),
    p99Ms: histogramPercentile(e2eDiffed, 0.99),
    count: e2eDiffed.count,
    sum: e2eDiffed.sum,
  };

  return { receivedBySeverity, acceptedBySeverity, droppedBySeverityAndReason, jobsProcessed, jobsFailed, e2eHistogram };
}

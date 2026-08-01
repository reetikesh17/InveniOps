// Assembles the final report object from every source (k6 summary, /metrics
// diff, Mongo counts/samples, docker stats) and renders both the
// machine-readable JSON and the console summary from the SAME object — so
// the two can never say different things.

function fmtMs(ms) {
  return ms === null || ms === undefined ? "n/a" : `${Math.round(ms)}ms`;
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return "n/a";
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * Merges N shards' k6 summary exports into one summary-shaped object, so
 * buildReport() below can consume it exactly like a single-shard run. Only
 * defensible operations across shards: counters SUM (each shard counted
 * disjoint requests), and latency percentiles do NOT — averaging or
 * summing percentiles across independent samples isn't mathematically
 * valid. For latency we report the per-shard average of medians/p95s as an
 * approximation (labeled as such) and the MAX p99/max across shards
 * (the honest worst case, not hidden by averaging it away).
 */
export function mergeK6Summaries(summaries) {
  const valid = summaries.filter(Boolean);
  const sumField = (name, field) =>
    valid.reduce((sum, s) => sum + (s.metrics?.[name]?.[field] ?? 0), 0);
  const avgField = (name, field) => {
    const vals = valid.map((s) => s.metrics?.[name]?.[field]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const maxField = (name, field) => {
    const vals = valid.map((s) => s.metrics?.[name]?.[field]).filter((v) => typeof v === "number");
    return vals.length ? Math.max(...vals) : null;
  };

  const counterNames = [
    "signals_accepted_202",
    "signals_rate_limited_429",
    "signals_buffer_saturated_503",
    "signals_other_status",
    "signals_request_errors",
    "signals_sampled_sent",
    "dropped_iterations",
    "iterations",
    "http_reqs",
  ];
  const metrics = {};
  for (const name of counterNames) {
    metrics[name] = { count: sumField(name, "count") };
  }
  metrics.http_req_duration = {
    avg: avgField("http_req_duration", "avg"),
    "p(50)": avgField("http_req_duration", "p(50)"),
    "p(95)": avgField("http_req_duration", "p(95)"),
    // Worst case across shards, not averaged away — this is the number
    // most likely to matter to a reader deciding whether tail latency is
    // acceptable.
    "p(99)": maxField("http_req_duration", "p(99)"),
    max: maxField("http_req_duration", "max"),
    min: (() => {
      const vals = valid
        .map((s) => s.metrics?.http_req_duration?.min)
        .filter((v) => typeof v === "number");
      return vals.length ? Math.min(...vals) : null;
    })(),
  };

  return {
    metrics,
    shardCount: valid.length,
    note: "avg/p50/p95 are averaged across shards (approximate); p99/max are the worst observed across shards, not averaged.",
  };
}

function percentileOf(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

export function summarizePerSignalSamples(samples) {
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  if (latencies.length === 0) {
    return { sampleSize: 0, p50Ms: null, p95Ms: null, p99Ms: null, minMs: null, maxMs: null };
  }
  return {
    sampleSize: latencies.length,
    p50Ms: percentileOf(latencies, 0.5),
    p95Ms: percentileOf(latencies, 0.95),
    p99Ms: percentileOf(latencies, 0.99),
    minMs: latencies[0],
    maxMs: latencies[latencies.length - 1],
  };
}

export function buildReport(input) {
  const {
    runId,
    scenario,
    config,
    environment,
    startedAt,
    endedAt,
    k6Summary,
    metricsBefore,
    metricsDiff, // { receivedBySeverity, acceptedBySeverity, droppedBySeverityAndReason, jobsProcessed, jobsFailed, e2eHistogram: {p50,p95,p99,count,sum} }
    persistedTotal,
    persistedTimeSeries,
    perSignalLatency, // from summarizePerSignalSamples
    resourcePeaks, // { peakBufferFillRatio, peakQueueDepth, peakDlqSize, peakBackendMemoryBytes }
    warnings,
  } = input;

  const durationSec = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;

  // k6's --summary-export puts fields directly on each metric object
  // (metrics.<name>.count / .avg / ."p(95)" / ...), NOT nested under a
  // `.values` key — verified against a real export, not assumed from docs.
  const k6 = k6Summary?.metrics || {};
  const accepted202 = k6.signals_accepted_202?.count ?? 0;
  const rateLimited429 = k6.signals_rate_limited_429?.count ?? 0;
  const bufferSaturated503 = k6.signals_buffer_saturated_503?.count ?? 0;
  const otherStatus = k6.signals_other_status?.count ?? 0;
  const requestErrors = k6.signals_request_errors?.count ?? 0;
  const totalRequests =
    accepted202 + rateLimited429 + bufferSaturated503 + otherStatus + requestErrors;
  const droppedIterations = k6.dropped_iterations?.count ?? 0;
  const durationVals = k6.http_req_duration || {};

  const gapCount = accepted202 - persistedTotal;
  const gapPercent = accepted202 > 0 ? gapCount / accepted202 : 0;

  const report = {
    runId,
    scenario,
    startedAt,
    endedAt,
    durationSec,
    config,
    environment,
    edge: {
      totalRequests,
      accepted202,
      rateLimited429,
      bufferSaturated503,
      otherStatus,
      requestErrors,
      acceptedPerSec: durationSec > 0 ? accepted202 / durationSec : 0,
      latencyMs: {
        avg: durationVals.avg ?? null,
        p50: durationVals["p(50)"] ?? durationVals.med ?? null,
        p95: durationVals["p(95)"] ?? null,
        p99: durationVals["p(99)"] ?? null,
        max: durationVals.max ?? null,
      },
      droppedIterations,
      generatorMayHaveBottlenecked: droppedIterations > 0,
    },
    backendCounters: metricsDiff,
    persistence: {
      totalPersisted: persistedTotal,
      persistedPerSec: durationSec > 0 ? persistedTotal / durationSec : 0,
      timeSeries: persistedTimeSeries,
      gapVsAccepted: {
        acceptedTotal: accepted202,
        persistedTotal,
        gapCount,
        gapPercent,
      },
    },
    endToEndLatency: {
      backendBatchHistogram: {
        note: "Recorded once per BullMQ batch job, using the OLDEST signal's wait time in that batch — a worst-case-in-batch proxy, not a true per-signal distribution. See ims_signal_e2e_latency_ms in backend/src/workers/signalWorker.ts.",
        p50Ms: metricsDiff.e2eHistogram.p50Ms,
        p95Ms: metricsDiff.e2eHistogram.p95Ms,
        p99Ms: metricsDiff.e2eHistogram.p99Ms,
        observationCount: metricsDiff.e2eHistogram.count,
      },
      perSignalPollingSample: {
        note: `External measurement: ${config.sampleRate * 100}% of signals tagged, polled for first appearance in Mongo every ${config.pollIntervalMs}ms. Accurate to within one poll interval. Independent cross-check against the backend's own histogram above.`,
        ...perSignalLatency,
      },
    },
    resourceUsage: {
      peakBufferFillRatio: resourcePeaks.peakBufferFillRatio,
      peakQueueDepth: resourcePeaks.peakQueueDepth,
      peakDlqSize: resourcePeaks.peakDlqSize,
      peakBackendMemoryBytes: resourcePeaks.peakBackendMemoryBytes,
      peakBackendMemoryMiB: resourcePeaks.peakBackendMemoryBytes
        ? resourcePeaks.peakBackendMemoryBytes / 1024 / 1024
        : null,
    },
    warnings,
  };

  return report;
}

export function renderConsoleSummary(report) {
  const lines = [];
  const hr = "─".repeat(72);
  lines.push(hr);
  lines.push(`LOAD TEST — ${report.scenario}  (run ${report.runId})`);
  lines.push(`${report.startedAt} → ${report.endedAt}  (${report.durationSec.toFixed(1)}s)`);
  const shardCount = report.config.shardCount || 1;
  lines.push(
    `Generator: ${shardCount} k6 shard(s) (source IPs) — per-IP limiter theoretical ceiling ≈ ${shardCount * 20}/s sustained, ${shardCount * 50}/s burst`,
  );
  lines.push(hr);

  lines.push("");
  lines.push("EDGE (HTTP)");
  lines.push(`  Total requests:        ${report.edge.totalRequests}`);
  lines.push(
    `  202 accepted:          ${report.edge.accepted202}  (${fmtPct(report.edge.accepted202 / (report.edge.totalRequests || 1))})`,
  );
  lines.push(
    `  429 rate-limited:      ${report.edge.rateLimited429}  (${fmtPct(report.edge.rateLimited429 / (report.edge.totalRequests || 1))})`,
  );
  lines.push(
    `  503 buffer-saturated:  ${report.edge.bufferSaturated503}  (${fmtPct(report.edge.bufferSaturated503 / (report.edge.totalRequests || 1))})`,
  );
  lines.push(`  Other status:          ${report.edge.otherStatus}`);
  lines.push(`  Request errors:        ${report.edge.requestErrors}`);
  lines.push(`  Accepted/sec (avg):    ${report.edge.acceptedPerSec.toFixed(1)}`);
  lines.push(
    `  Edge latency:          p50 ${fmtMs(report.edge.latencyMs.p50)}  p95 ${fmtMs(report.edge.latencyMs.p95)}  p99 ${fmtMs(report.edge.latencyMs.p99)}  max ${fmtMs(report.edge.latencyMs.max)}`,
  );
  if (report.edge.generatorMayHaveBottlenecked) {
    lines.push(
      `  ⚠ dropped_iterations=${report.edge.droppedIterations} — the GENERATOR could not keep up with the configured rate; the reported rate above is not the full offered load.`,
    );
  }

  lines.push("");
  lines.push("PERSISTENCE (the actual result of this test)");
  lines.push(`  Persisted to Mongo:    ${report.persistence.totalPersisted}`);
  lines.push(`  Persisted/sec (avg):   ${report.persistence.persistedPerSec.toFixed(1)}`);
  lines.push(
    `  ACCEPTED vs PERSISTED GAP: ${report.persistence.gapVsAccepted.gapCount} (${fmtPct(report.persistence.gapVsAccepted.gapPercent)}) — signals the edge said "202 accepted" for but that had not landed in Mongo by the time this run's measurement window closed.`,
  );

  lines.push("");
  lines.push("SHED / DROPPED (by severity, from the backend's own counters)");
  for (const severity of ["P0", "P1", "P2", "P3"]) {
    const reasons = report.backendCounters.droppedBySeverityAndReason[severity] || {};
    const total =
      (reasons.shed_ceiling || 0) + (reasons.hard_capacity || 0) + (reasons.sink_failure || 0);
    if (total > 0) {
      lines.push(
        `  ${severity}: ${total}  (shed_ceiling=${reasons.shed_ceiling || 0} hard_capacity=${reasons.hard_capacity || 0} sink_failure=${reasons.sink_failure || 0})`,
      );
    }
  }

  lines.push("");
  lines.push("END-TO-END LATENCY (receipt → persisted)");
  lines.push(
    `  Backend batch histogram (job-level, oldest-in-batch): p50 ${fmtMs(report.endToEndLatency.backendBatchHistogram.p50Ms)}  p95 ${fmtMs(report.endToEndLatency.backendBatchHistogram.p95Ms)}  p99 ${fmtMs(report.endToEndLatency.backendBatchHistogram.p99Ms)}  (n=${report.endToEndLatency.backendBatchHistogram.observationCount})`,
  );
  const perSignal = report.endToEndLatency.perSignalPollingSample;
  lines.push(
    `  Per-signal polling sample: p50 ${fmtMs(perSignal.p50Ms)}  p95 ${fmtMs(perSignal.p95Ms)}  p99 ${fmtMs(perSignal.p99Ms)}  (n=${perSignal.sampleSize})`,
  );

  lines.push("");
  lines.push("RESOURCE USAGE");
  lines.push(`  Peak buffer fill:      ${fmtPct(report.resourceUsage.peakBufferFillRatio)}`);
  lines.push(`  Peak queue depth:      ${report.resourceUsage.peakQueueDepth}`);
  lines.push(`  Peak DLQ size:         ${report.resourceUsage.peakDlqSize}`);
  lines.push(`  Peak backend memory:   ${fmtBytes(report.resourceUsage.peakBackendMemoryBytes)}`);

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("WARNINGS");
    for (const w of report.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  lines.push(hr);
  return lines.join("\n");
}

// Polls GET /metrics throughout the run to capture peaks that only exist
// transiently — buffer fill and queue depth are gauges, so the only way to
// know their maximum during the run is to have actually been watching
// during the run, not just diffed a before/after snapshot (which is fine
// for the cumulative counters, but says nothing about a peak that came and
// went in between).
import { scrapeMetrics, findValue, sumValues } from "./metrics.js";

export function startBackendPoller(baseUrl, intervalMs, onSample) {
  let stopped = false;
  let timer = null;
  let peakBufferFillRatio = 0;
  let peakQueueDepth = 0;
  let peakDlqSize = 0;
  let latest = null;
  const startedAtMs = Date.now();

  const tick = async () => {
    if (stopped) {
      return;
    }
    try {
      const samples = await scrapeMetrics(baseUrl);
      const bufferFillRatio = findValue(samples, "ims_buffer_fill_ratio");
      const queueDepth = sumValues(samples, "ims_queue_depth"); // waiting + active, summed across both label values
      const dlqSize = findValue(samples, "ims_queue_dlq_size");

      peakBufferFillRatio = Math.max(peakBufferFillRatio, bufferFillRatio);
      peakQueueDepth = Math.max(peakQueueDepth, queueDepth);
      peakDlqSize = Math.max(peakDlqSize, dlqSize);
      latest = { bufferFillRatio, queueDepth, dlqSize };

      onSample({
        atMs: Date.now(),
        elapsedMs: Date.now() - startedAtMs,
        bufferFillRatio,
        queueDepth,
        dlqSize,
      });
    } catch (error) {
      onSample({ atMs: Date.now(), elapsedMs: Date.now() - startedAtMs, error: String(error) });
    }
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
    getPeaks: () => ({ peakBufferFillRatio, peakQueueDepth, peakDlqSize }),
    getLatest: () => latest,
  };
}

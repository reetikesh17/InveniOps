// Everything k6 can't see: whether a signal actually made it into Mongo,
// and (for a small tagged sample) how long that actually took. Both are
// external, non-invasive observations — no schema change, no code in the
// path being measured touches this.
import { MongoClient } from "mongodb";

export class MongoSampler {
  constructor(uri, dbName) {
    this.client = new MongoClient(uri);
    this.dbName = dbName;
  }

  async connect() {
    await this.client.connect();
    this.collection = this.client.db(this.dbName).collection("signals");
  }

  async close() {
    await this.client.close();
  }

  /** Every signal this run produced, regardless of sample flag. */
  allPrefix(runId) {
    return `^lt-${runId}-`;
  }

  /** Just the latency-sample subset (the "S" flag — see k6/lib/payload.js). */
  samplePrefix(runId) {
    return `^lt-${runId}-S-`;
  }

  async countPersisted(runId) {
    return this.collection.countDocuments({ signalId: { $regex: this.allPrefix(runId) } });
  }

  /**
   * Polls the persisted count on an interval and hands each
   * {atMs, elapsedMs, count} sample to onSample — the persisted/sec time
   * series the top-line "gap vs accepted/sec" number is built from. Stop
   * with the returned function; it resolves once the in-flight poll (if
   * any) finishes, so no reading is torn.
   */
  startPersistedCountPoller(runId, intervalMs, onSample) {
    const startedAtMs = Date.now();
    let stopped = false;
    let timer = null;

    const tick = async () => {
      if (stopped) {
        return;
      }
      try {
        const count = await this.countPersisted(runId);
        const atMs = Date.now();
        onSample({ atMs, elapsedMs: atMs - startedAtMs, count });
      } catch (error) {
        onSample({ atMs: Date.now(), elapsedMs: Date.now() - startedAtMs, count: null, error: String(error) });
      }
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
      }
    };

    timer = setTimeout(tick, 0);

    return async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }

  /**
   * Polls specifically for the sampled subset, and for each signalId not
   * seen before, records `firstSeenAtMs` (this poll's wall-clock time) and
   * reads back `rawPayload.sentAtMs` (embedded by k6 at generation time —
   * see k6/lib/payload.js) straight off the document. The resulting
   * `firstSeenAtMs - sentAtMs` is the end-to-end latency for that signal,
   * accurate to within one poll interval (documented as such in the
   * report — this is a real, if coarse-grained, per-signal measurement,
   * distinct from the backend's own job-batch-level histogram).
   */
  startLatencySamplePoller(runId, intervalMs) {
    const seen = new Map(); // signalId -> { sentAtMs, firstSeenAtMs, latencyMs }
    let stopped = false;
    let timer = null;

    const tick = async () => {
      if (stopped) {
        return;
      }
      try {
        const docs = await this.collection
          .find(
            { signalId: { $regex: this.samplePrefix(runId) } },
            { projection: { signalId: 1, rawPayload: 1 } },
          )
          .toArray();
        const atMs = Date.now();
        for (const doc of docs) {
          if (seen.has(doc.signalId)) {
            continue;
          }
          const sentAtMs = doc.rawPayload && typeof doc.rawPayload.sentAtMs === "number" ? doc.rawPayload.sentAtMs : null;
          seen.set(doc.signalId, {
            sentAtMs,
            firstSeenAtMs: atMs,
            latencyMs: sentAtMs === null ? null : atMs - sentAtMs,
          });
        }
      } catch {
        // A transient poll failure just means we try again next tick —
        // this is a best-effort sample, not the primary accepted/persisted
        // count (that's countPersisted, which the caller retries on its
        // own schedule regardless of this poller's health).
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
      getSamples: () => [...seen.values()].filter((s) => s.latencyMs !== null),
    };
  }
}

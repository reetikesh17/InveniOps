// "Kill a worker mid-job" — in this codebase the BullMQ worker runs
// in-process with the API server (see src/index.ts: one Node process,
// docker-compose has one `backend` service, no separate worker
// container/service). So a worker crash here means SIGKILLing the whole
// backend process mid-job and relying on BullMQ's own stalled-job recovery
// (the lock the crashed worker held on its in-flight job expires, and once
// a new worker instance starts polling the same Redis-backed queue, BullMQ
// hands the stalled job to it) — not a separate process being restarted.
//
// Runs against a temporary, isolated backend instance (see
// helpers/ephemeralBackend.ts), same as queueSaturation.test.ts and for the
// same underlying reason: a single request submitting BATCH_SIZE signals
// costs BATCH_SIZE tokens against the real dev container's per-IP bucket
// (see src/api/routes/signals.ts's `cost = parsed.signals.length`), and
// that bucket's capacity (default 50) can never admit a single request
// costing more than capacity, regardless of timing — this isn't about
// exercising the rate limiter, so it's raised out of the way. BullMQ
// lock/stalled-check timing (the thing actually under test here) is left
// at its real defaults, unlike the buffer tuning queueSaturation.test.ts
// does for its own purposes.
//
// Asserts the job is not lost (its signals eventually persist) and that
// insertManyIdempotent's dedup means reprocessing never doubles them up.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { kill, start, isRunning } from "./helpers/docker.js";
import { waitFor, sleep } from "./helpers/waitFor.js";
import { startEphemeralBackend, type EphemeralBackend } from "./helpers/ephemeralBackend.js";
import type { SignalInput, HealthResponse } from "./helpers/apiClient.js";
import { makeMongoDb, makeRedisClient } from "./helpers/dataClients.js";

// Same queue name the app itself uses — see src/workers/queue.ts's
// SIGNAL_BATCH_QUEUE_NAME. Duplicated here (not imported from src/)
// deliberately: this test drives the app purely as an external HTTP/Docker
// caller, same posture as the rest of tests/chaos/.
const SIGNAL_BATCH_QUEUE_NAME = "signal-batch-processing";

const RUN_TAG = `chaos-workercrash-${Date.now()}`;
const BATCH_SIZE = 500; // the API's own max batch size — maximizes the job's processing window to widen the kill race
const HOST_PORT = 3098;

async function health(baseUrl: string): Promise<{ httpStatus: number; body: HealthResponse }> {
  const res = await fetch(`${baseUrl}/health`);
  const body = (await res.json()) as HealthResponse;
  return { httpStatus: res.status, body };
}

describe("chaos: worker crash", () => {
  let backend: EphemeralBackend;

  beforeAll(async () => {
    backend = await startEphemeralBackend("worker-crash", HOST_PORT, {
      RATE_LIMIT_IP_CAPACITY: "1000000",
      RATE_LIMIT_IP_REFILL_PER_SECOND: "1000000",
      RATE_LIMIT_GLOBAL_CAPACITY: "1000000",
      RATE_LIMIT_GLOBAL_REFILL_PER_SECOND: "1000000",
      // The in-memory ingestion buffer (pre-drain) has NO durability of its
      // own — a signal sitting there when the process is SIGKILLed is
      // gone for good; only once it's drained into a BullMQ job (durably
      // queued in Redis) is it protected by BullMQ's stalled-job recovery.
      // So the drain itself is kept at its normal FAST pace (just a
      // smaller batch size, to produce more, smaller jobs) — the test
      // below explicitly waits for the buffer to fully empty (proving
      // every signal is durably queued) before it ever looks for a job to
      // kill mid-processing. What's slowed down instead is PROCESSING
      // (concurrency 1, serialized), which widens the window during which
      // some already-durable job is actively being worked — that's the
      // actual "mid-job" moment BullMQ's stalled-job recovery is for.
      // Small batches drained FAST (so the buffer empties in ~100-200ms,
      // well before all ~20 resulting jobs can possibly finish), combined
      // with concurrency forced to 1 (so those jobs process strictly
      // serially, each doing real Mongo/Postgres I/O — tens of ms, not
      // instant): drain rate deliberately outpaces processing rate, so a
      // real backlog reliably still exists once the buffer's fully
      // empty — not a coin flip on exact timing.
      BUFFER_DRAIN_BATCH_SIZE: "25",
      BUFFER_DRAIN_INTERVAL_MS: "10",
      QUEUE_WORKER_CONCURRENCY: "1",
    });
  }, 45_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it("does not lose an in-flight job's signals across a hard crash, and never duplicates them on reprocessing", async () => {
    const signals: SignalInput[] = Array.from({ length: BATCH_SIZE }, (_, i) => ({
      signalId: `${RUN_TAG}-${i}`,
      componentId: `${RUN_TAG}-component-${i % 20}`, // spread across 20 components so the job does real debounce/dedup work, not one trivial insert
      componentType: "NOSQL",
      severity: i % 7 === 0 ? "P0" : "P3",
      rawPayload: { chaosTest: "worker-crash", index: i },
      occurredAt: new Date().toISOString(),
    }));

    const res = await fetch(`${backend.baseUrl}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
    });
    const ingestBody = (await res.json()) as { accepted?: number };
    expect(res.status).toBe(202);
    expect(ingestBody.accepted).toBe(BATCH_SIZE);

    // First, wait for the buffer to fully empty — every signal is now a
    // durable BullMQ job in Redis, not sitting in volatile process
    // memory. Only once that's true is it safe (and meaningful) to look
    // for a job to kill mid-processing: killing before this point risks
    // permanently losing whatever's still un-drained, which would be
    // testing something this system was never designed to survive.
    await waitFor(
      async () => {
        const { body } = await health(backend.baseUrl);
        return body.buffer.depth === 0;
      },
      {
        timeoutMs: 15_000,
        intervalMs: 100,
        description: "the ingestion buffer to fully drain into durable BullMQ jobs",
      },
    );

    // Concurrency 1 above serializes the resulting ~20 jobs, so the
    // queue stays busy for a while after the buffer's already empty.
    // Queried directly against BullMQ/Redis, not through /health's
    // queue.activeCount — that's a CACHED probe (background-refreshed
    // on its own interval, see healthProbeInstance.ts), and polling it
    // faster doesn't help if the real queue drains between refreshes;
    // it produced real, observed flakes here. A live BullMQ read has no
    // such lag. Asserted below, not just informational, since a false
    // negative here would mean this test isn't actually exercising
    // "mid-job."
    const probeQueue = new Queue(SIGNAL_BATCH_QUEUE_NAME, { connection: makeRedisClient() });
    let caughtActive = false;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activeCount = await probeQueue.getActiveCount();
        if (activeCount > 0) {
          caughtActive = true;
          break;
        }
        await sleep(25);
      }
    } finally {
      await probeQueue.close();
    }
    expect(caughtActive).toBe(true); // genuinely killed mid-job, not just "killed near an already-finished job"

    await kill(backend.containerName, "SIGKILL");
    expect(await isRunning(backend.containerName)).toBe(false);

    await start(backend.containerName);
    await waitFor(
      async () => {
        try {
          const { httpStatus } = await health(backend.baseUrl);
          return httpStatus === 200 || httpStatus === 503;
        } catch {
          return false;
        }
      },
      { timeoutMs: 30_000, description: "backend to come back up after the crash" },
    );

    // BullMQ's stalled-job recovery: the crashed worker's lock on this
    // job expires (default lockDuration ~30s), and the periodic stalled
    // check (default interval ~30s) reassigns it to the new worker
    // instance once this container is healthy again — generous timeout
    // to cover both.
    const { db, close } = await makeMongoDb();
    try {
      await waitFor(
        async () => {
          const count = await db
            .collection("signals")
            .countDocuments({ signalId: { $regex: `^${RUN_TAG}-` } });
          return count === BATCH_SIZE;
        },
        {
          timeoutMs: 120_000,
          intervalMs: 2_000,
          description: "all signals from the crashed job to eventually persist",
        },
      );

      // Idempotency: exactly one document per signalId, never more —
      // proves reprocessing (whether the crash happened before or after
      // the original attempt's partial Mongo insert) never double-wrote.
      const counts = await db
        .collection("signals")
        .aggregate([
          { $match: { signalId: { $regex: `^${RUN_TAG}-` } } },
          { $group: { _id: "$signalId", count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
        ])
        .toArray();
      expect(counts).toEqual([]);

      const totalDocs = await db
        .collection("signals")
        .countDocuments({ signalId: { $regex: `^${RUN_TAG}-` } });
      expect(totalDocs).toBe(BATCH_SIZE); // not one more, not one fewer
    } finally {
      await close();
    }
  }, 180_000);
});

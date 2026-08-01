// Sends SIGTERM (via `docker stop`, the same signal path a real
// orchestrator uses for a graceful redeploy) while a burst is still
// in-flight, and asserts the shutdown hook (src/index.ts's
// registerShutdownHooks -> signalBuffer.drainAll) actually ran and
// actually drained the buffer within its timeout, rather than the process
// just dying and everything happening to survive via BullMQ's unrelated
// stalled-job recovery (that's workerCrash.test.ts's mechanism, and a
// graceful shutdown should not need to fall back to it).
//
// Runs against a temporary, isolated backend instance (see
// helpers/ephemeralBackend.ts) — same reason as workerCrash.test.ts: one
// request submitting BATCH_SIZE signals costs BATCH_SIZE tokens against
// the real dev container's per-IP bucket (default capacity 50), which a
// single request can never satisfy regardless of timing. Elevated here
// only for the rate limiter; drain/queue/shutdown timing is untouched.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stop, start, isRunning, logsSince } from "./helpers/docker.js";
import { waitFor } from "./helpers/waitFor.js";
import { startEphemeralBackend, type EphemeralBackend } from "./helpers/ephemeralBackend.js";
import type { SignalInput, HealthResponse } from "./helpers/apiClient.js";
import { makeMongoDb } from "./helpers/dataClients.js";

const RUN_TAG = `chaos-shutdown-${Date.now()}`;
const BATCH_SIZE = 500;
const HOST_PORT = 3099;
// Comfortably above the app's own BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS (10s
// default) + QUEUE_SHUTDOWN_TIMEOUT_MS (10s default), so `docker stop`
// gives the shutdown hook room to finish on its own before Docker's grace
// period would SIGKILL it instead.
const STOP_GRACE_SECONDS = 30;

async function health(baseUrl: string): Promise<{ httpStatus: number; body: HealthResponse }> {
  const res = await fetch(`${baseUrl}/health`);
  const body = (await res.json()) as HealthResponse;
  return { httpStatus: res.status, body };
}

describe("chaos: graceful shutdown (SIGTERM under active load)", () => {
  let backend: EphemeralBackend;

  beforeAll(async () => {
    backend = await startEphemeralBackend("graceful-shutdown", HOST_PORT, {
      RATE_LIMIT_IP_CAPACITY: "1000000",
      RATE_LIMIT_IP_REFILL_PER_SECOND: "1000000",
      RATE_LIMIT_GLOBAL_CAPACITY: "1000000",
      RATE_LIMIT_GLOBAL_REFILL_PER_SECOND: "1000000",
    });
  }, 45_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it("drains the buffer within the shutdown timeout and loses nothing in flight", async () => {
    const signals: SignalInput[] = Array.from({ length: BATCH_SIZE }, (_, i) => ({
      signalId: `${RUN_TAG}-${i}`,
      componentId: `${RUN_TAG}-component-${i % 20}`,
      componentType: "API",
      severity: i % 7 === 0 ? "P0" : "P3",
      rawPayload: { chaosTest: "graceful-shutdown", index: i },
      occurredAt: new Date().toISOString(),
    }));

    const shutdownWindowStartedAt = new Date().toISOString();

    // Fully await the ingest response before sending SIGTERM — racing
    // them concurrently risks Docker tearing down the container's port
    // forwarding mid-response (truncating it) before the app has even
    // started its own shutdown sequence, which would be a test-harness
    // artifact, not the thing being tested. The 202 response itself is
    // near-instant (the buffer accepts in-memory), so the batch is still
    // realistically draining through the buffer/queue by the time
    // `stop` below sends SIGTERM a moment later — that's the actual
    // "in flight" window this test cares about.
    const ingestRes = await fetch(`${backend.baseUrl}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
    });
    const ingestBody = (await ingestRes.json()) as { accepted?: number };
    expect(ingestRes.status).toBe(202); // accepted before shutdown began tearing things down
    expect(ingestBody.accepted).toBe(BATCH_SIZE);

    await stop(backend.containerName, STOP_GRACE_SECONDS);
    expect(await isRunning(backend.containerName)).toBe(false); // docker stop returned only once the container actually exited

    // The shutdown hook itself ran and reported a drain result — proof
    // this recovered via the graceful path, not merely "the process died
    // and BullMQ's stalled-job mechanism bailed it out later."
    const shutdownLogs = await logsSince(backend.containerName, shutdownWindowStartedAt);
    expect(shutdownLogs).toContain("drained ingestion buffer on shutdown");
    expect(shutdownLogs).toMatch(/"signal":"SIGTERM"/);

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
      { timeoutMs: 30_000, description: "backend to come back up after restart" },
    );

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
          timeoutMs: 60_000,
          intervalMs: 1_000,
          description: "every signal accepted before shutdown to persist",
        },
      );
    } finally {
      await close();
    }
  }, 150_000);
});

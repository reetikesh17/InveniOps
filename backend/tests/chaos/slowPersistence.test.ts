// Pauses Mongo (freezes the process via cgroups — connections hang rather
// than refuse, unlike `docker stop`) mid-load and asserts the ingestion
// path is genuinely decoupled from persistence: it keeps accepting
// signals, fast, without crashing or growing memory unbounded, and nothing
// accepted is ever silently dropped — it all shows up once Mongo returns.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CONTAINERS,
  pause,
  unpause,
  isRunning,
  statsSnapshot,
  ensureRunning,
} from "./helpers/docker.js";
import { waitFor, sleep } from "./helpers/waitFor.js";
import { getHealth, postSignals, type SignalInput } from "./helpers/apiClient.js";
import { makeMongoDb } from "./helpers/dataClients.js";

const RUN_TAG = `chaos-slowpersist-${Date.now()}`;

function makeTrackedSignal(index: number): SignalInput {
  return {
    signalId: `${RUN_TAG}-${index}`,
    componentId: "CHAOS_SLOW_PERSISTENCE",
    componentType: "MCP_HOST",
    severity: index % 5 === 0 ? "P0" : "P2",
    rawPayload: { chaosTest: "slow-persistence" },
  };
}

describe("chaos: slow persistence (Mongo paused)", () => {
  beforeAll(async () => {
    const { httpStatus } = await getHealth();
    expect([200, 503]).toContain(httpStatus); // backend reachable at all before we start
  });

  beforeEach(async () => {
    await ensureRunning(CONTAINERS.mongo);
  });

  afterEach(async () => {
    await ensureRunning(CONTAINERS.mongo);
  }, 30_000);

  it("keeps accepting signals fast while Mongo is paused, stays alive and bounded, and drains fully once unpaused", async () => {
    await pause(CONTAINERS.mongo);

    try {
      // --- Ingestion must not notice Mongo is gone ---
      const signals = Array.from({ length: 30 }, (_, i) => makeTrackedSignal(i));
      const result = await postSignals(signals, 5_000);

      expect(result.status).toBe(202); // buffer capacity is nowhere near exhausted by 30 signals
      expect(result.body.accepted).toBe(30);
      // The whole point: acking ingestion never touches Mongo on the
      // request path, so a fully-paused Mongo should cost this call
      // nothing beyond ordinary request overhead.
      expect(result.durationMs).toBeLessThan(2_000);

      // --- Process survives, memory stays bounded, while still paused ---
      const memSamples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        expect(await isRunning(CONTAINERS.backend)).toBe(true);
        const stats = await statsSnapshot(CONTAINERS.backend);
        if (stats.memUsedBytes !== null) {
          memSamples.push(stats.memUsedBytes);
        }
        await sleep(1_500);
      }
      expect(memSamples.length).toBeGreaterThan(0);
      // Generous absolute ceiling (this backend idles around 100MB) —
      // the assertion is "did not run away," not "stayed under some
      // tight number."
      for (const bytes of memSamples) {
        expect(bytes).toBeLessThan(500 * 1024 * 1024);
      }

      // --- /health honestly reports the outage while it's ongoing ---
      await waitFor(
        async () => {
          const { body } = await getHealth();
          return body.dependencies.mongo.status === "down";
        },
        { timeoutMs: 15_000, description: "/health to report mongo as down" },
      );

      // --- Ingestion keeps accepting even after the outage has been observed ---
      const secondBatch = Array.from({ length: 10 }, (_, i) => makeTrackedSignal(100 + i));
      const secondResult = await postSignals(secondBatch, 5_000);
      expect(secondResult.status).toBe(202);
      expect(secondResult.durationMs).toBeLessThan(2_000);

      // --- Unpause: everything accepted must eventually persist ---
      await unpause(CONTAINERS.mongo);

      const { db, close } = await makeMongoDb();
      try {
        await waitFor(
          async () => {
            const count = await db
              .collection("signals")
              .countDocuments({ signalId: { $regex: `^${RUN_TAG}-` } });
            return count === 40;
          },
          {
            timeoutMs: 60_000,
            intervalMs: 1_000,
            description: "all 40 accepted signals to persist after Mongo recovers",
          },
        );

        const persistedIds = new Set(
          (
            await db
              .collection("signals")
              .find({ signalId: { $regex: `^${RUN_TAG}-` } }, { projection: { signalId: 1 } })
              .toArray()
          ).map((doc) => doc["signalId"] as string),
        );
        const expectedIds = [...signals, ...secondBatch].map((s) => s.signalId!);
        const missing = expectedIds.filter((id) => !persistedIds.has(id));
        expect(missing).toEqual([]); // no accepted signal silently lost
      } finally {
        await close();
      }

      // --- Backlog actually drained, not just "eventually consistent forever" ---
      await waitFor(
        async () => {
          const { body } = await getHealth();
          return body.queue.waitingCount === 0 && body.queue.activeCount === 0;
        },
        { timeoutMs: 30_000, description: "queue depth to return to 0 after the backlog clears" },
      );
    } finally {
      await ensureRunning(CONTAINERS.mongo);
    }
  }, 120_000);
});

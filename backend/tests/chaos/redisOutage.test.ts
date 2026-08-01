// Stops Redis and asserts the two things that depend on it degrade rather
// than error: the dashboard read path falls back to Postgres directly
// (src/repositories/redis/dashboardCache.ts + dashboardProjection.ts's
// CacheUnavailableError handling), and the ingestion rate limiter fails
// OPEN (see the justification comment on checkRateLimitFailOpen in
// src/api/routes/signals.ts, restated below). Also confirms recovery is
// automatic and the rate limiter isn't stuck fail-open once Redis returns.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTAINERS, stop, start, ensureRunning } from "./helpers/docker.js";
import { waitFor, sleep } from "./helpers/waitFor.js";
import { getHealth, postSignals, listActiveIncidents, getIncident } from "./helpers/apiClient.js";
import { makePrismaClient } from "./helpers/dataClients.js";
import type { PrismaClient } from "@prisma/client";

const RUN_TAG = `chaos-redisoutage-${Date.now()}`;

async function waitForWorkItemByComponent(
  prisma: PrismaClient,
  componentId: string,
  timeoutMs = 30_000,
): Promise<string> {
  let foundId: string | null = null;
  await waitFor(
    async () => {
      const workItem = await prisma.workItem.findFirst({ where: { componentId } });
      if (workItem) {
        foundId = workItem.id;
        return true;
      }
      return false;
    },
    {
      timeoutMs,
      intervalMs: 500,
      description: `a work item to be created for component ${componentId}`,
    },
  );
  return foundId!;
}

describe("chaos: Redis outage", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = makePrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await ensureRunning(CONTAINERS.redis);
    await prisma.$disconnect();
  });

  it("degrades the dashboard to Postgres and fails the rate limiter open, then recovers automatically", async () => {
    // --- Set up: a real, already-cached active incident ---
    const componentId = `${RUN_TAG}-component`;
    const setupResult = await postSignals({
      signalId: `${RUN_TAG}-setup`,
      componentId,
      componentType: "QUEUE",
      severity: "P1",
      rawPayload: { chaosTest: "redis-outage-setup" },
    });
    expect(setupResult.status).toBe(202);
    const workItemId = await waitForWorkItemByComponent(prisma, componentId);

    // Warm the cache under normal conditions first, so the degraded read
    // below is genuinely proving "Redis unreachable," not coincidentally
    // succeeding because it never needed Redis in the first place.
    const warmRead = await getIncident(workItemId);
    expect(warmRead.status).toBe(200);

    try {
      await stop(CONTAINERS.redis, 5);

      // --- Dashboard reads degrade to Postgres, not an error ---
      // This dev database has thousands of active work items accumulated
      // across earlier testing (severity-sorted, so a single freshly
      // created P1 item isn't guaranteed to land on a 200-item page) —
      // the list assertion is "the fallback returns real data," not
      // "contains this exact item." getIncident below is the precise,
      // ID-specific check that the fallback correctly serves *this* item.
      const activeList = await listActiveIncidents(200);
      expect(activeList.status).toBe(200); // NOT 500
      expect(activeList.total).toBeGreaterThan(0);
      expect(activeList.items.length).toBeGreaterThan(0);

      const detail = await getIncident(workItemId);
      expect(detail.status).toBe(200);
      expect(detail.body["id"]).toBe(workItemId);

      // --- Rate limiter fails OPEN: ingestion is not blocked by Redis being down ---
      // FAIL-OPEN, not closed — justification (see signals.ts): the rate
      // limiter protects against single-source abuse, it is not this
      // system's primary backpressure mechanism (the in-memory buffer,
      // independent of Redis, is). Failing closed would let a
      // non-critical dependency take down ingestion entirely, which
      // directly contradicts "ingestion must never block on
      // persistence/infra" (CLAUDE.md). The buffer's own bounded
      // capacity still protects memory regardless of this choice.
      const duringOutage = await postSignals(
        {
          signalId: `${RUN_TAG}-during-outage`,
          componentId: `${RUN_TAG}-during-outage-component`,
          componentType: "QUEUE",
          severity: "P2",
          rawPayload: { chaosTest: "redis-outage-ingest" },
        },
        5_000,
      );
      // Bound is 3s, not tight against the 2s commandTimeout itself
      // (clients.ts) — proving "fails open fast," not literally racing
      // the timeout value and risking flakiness on a slow CI host.
      expect(duringOutage.status).toBe(202);
      expect(duringOutage.durationMs).toBeLessThan(3_000);

      // --- /health still honestly reports the outage (degradation != hiding it) ---
      await waitFor(
        async () => {
          const { httpStatus, body } = await getHealth();
          return httpStatus === 503 && body.dependencies.redis.status === "down";
        },
        { timeoutMs: 15_000, description: "/health to report 503 with redis down" },
      );
    } finally {
      await start(CONTAINERS.redis);
    }

    // --- Recovery is automatic ---
    await waitFor(
      async () => {
        const { body } = await getHealth();
        return body.dependencies.redis.status === "up";
      },
      { timeoutMs: 30_000, description: "/health to report redis up again after restart" },
    );

    // Give the ingestion route's Redis client a moment to reconnect
    // (ioredis auto-reconnects, but not instantaneously).
    await sleep(2_000);

    // --- The rate limiter is not stuck fail-open — it actively rejects again ---
    // RATE_LIMIT_IP_CAPACITY defaults to 50; comfortably exceed it from
    // one source (this test process) in one burst.
    const burst = await Promise.all(
      Array.from({ length: 80 }, (_, i) =>
        postSignals(
          {
            signalId: `${RUN_TAG}-postrecovery-${i}`,
            componentId: `${RUN_TAG}-postrecovery-component`,
            componentType: "QUEUE",
            severity: "P3",
            rawPayload: { chaosTest: "redis-outage-postrecovery" },
          },
          5_000,
        ),
      ),
    );
    expect(burst.some((result) => result.status === 429)).toBe(true);
  }, 120_000);
});

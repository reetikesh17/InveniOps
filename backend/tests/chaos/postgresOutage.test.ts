// Stops Postgres mid-workflow and asserts: the retry wrapper visibly
// engages (logged, not silent) before giving up, /health names Postgres as
// the down dependency, a failed transition leaves the work item's state
// completely unchanged (never partially applied), ingestion itself stays
// decoupled from Postgres exactly like it is from Mongo, and everything
// recovers automatically once Postgres comes back — no restart, no manual
// fix-up.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTAINERS, stop, start, logsSince, ensureRunning } from "./helpers/docker.js";
import { waitFor } from "./helpers/waitFor.js";
import {
  getHealth,
  postSignals,
  transitionIncident,
  ensureAuthToken,
  type SignalInput,
} from "./helpers/apiClient.js";
import { makePrismaClient } from "./helpers/dataClients.js";
import type { PrismaClient } from "@prisma/client";

const RUN_TAG = `chaos-pgoutage-${Date.now()}`;

async function waitForWorkItemByComponent(
  prisma: PrismaClient,
  componentId: string,
  timeoutMs = 30_000,
): Promise<string> {
  let foundId: string | null = null;
  await waitFor(
    async () => {
      const workItem = await prisma.workItem.findFirst({
        where: { componentId },
        orderBy: { createdAt: "desc" },
      });
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

describe("chaos: Postgres outage", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = makePrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await ensureRunning(CONTAINERS.postgres);
    await prisma.$disconnect();
  });

  it("retries visibly, reports 503 naming postgres, leaves state uncorrupted, and recovers without intervention", async () => {
    // --- Set up: a real work item to attempt a transition against ---
    const componentId = `${RUN_TAG}-component`;
    const setupSignal: SignalInput = {
      signalId: `${RUN_TAG}-setup`,
      componentId,
      componentType: "RDBMS",
      severity: "P1",
      rawPayload: { chaosTest: "postgres-outage-setup" },
    };
    const setupResult = await postSignals(setupSignal);
    expect(setupResult.status).toBe(202);

    const workItemId = await waitForWorkItemByComponent(prisma, componentId);
    const before = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(before.state).toBe("OPEN");

    const outageStartedAt = new Date().toISOString();

    // Signup (needed to call the now-authenticated transition endpoint
    // below) itself requires Postgres — get the token before it goes down,
    // so the outage under test is the transition endpoint's, not an
    // incidental failure to sign up.
    await ensureAuthToken();

    try {
      await stop(CONTAINERS.postgres, 5);

      // --- A transition attempted during the outage must fail cleanly, not hang ---
      // Bound is 20s, not the backoff math alone (attempts=3, ~50ms base
      // — well under a second of sleep). The dominant cost is each
      // individual attempt's own connection failure against a Postgres
      // that's mid-shutdown (docker stop's grace period) rather than
      // instantly refusing — measured up to ~9s for 3 attempts in
      // practice. Still a small, fixed, known ceiling (not unbounded),
      // which is the actual property being asserted here.
      const failedTransition = await transitionIncident(
        workItemId,
        "INVESTIGATING",
        "chaos-test",
        20_000,
      );
      expect(failedTransition.status).toBeGreaterThanOrEqual(500);
      expect(failedTransition.status).toBeLessThan(600);
      expect(failedTransition.durationMs).toBeLessThan(15_000);

      // --- Retry logic visibly engaged (logged), not silent ---
      const logs = await logsSince(CONTAINERS.backend, outageStartedAt);
      const retryLines = logs
        .split("\n")
        .filter((line) => line.includes("retrying postgres operation after a transient error"));
      expect(retryLines.length).toBeGreaterThan(0);
      expect(logs).toMatch(/"attempt":1/);

      // --- Ingestion itself stays decoupled from Postgres too ---
      const duringOutageSignal: SignalInput = {
        signalId: `${RUN_TAG}-during-outage`,
        componentId: `${RUN_TAG}-during-outage-component`,
        componentType: "RDBMS",
        severity: "P2",
        rawPayload: { chaosTest: "postgres-outage-ingest" },
      };
      const duringOutageResult = await postSignals(duringOutageSignal, 5_000);
      expect(duringOutageResult.status).toBe(202);
      expect(duringOutageResult.durationMs).toBeLessThan(2_000);

      // --- /health reports the outage explicitly, naming postgres ---
      await waitFor(
        async () => {
          const { httpStatus, body } = await getHealth();
          return httpStatus === 503 && body.dependencies.postgres.status === "down";
        },
        { timeoutMs: 15_000, description: "/health to report 503 with postgres down" },
      );
    } finally {
      await start(CONTAINERS.postgres);
    }

    // --- Recovery is automatic: wait for health to reflect it, no restart of the app ---
    await waitFor(
      async () => {
        const { body } = await getHealth();
        return body.dependencies.postgres.status === "up";
      },
      { timeoutMs: 30_000, description: "/health to report postgres up again after restart" },
    );

    // The test's own long-lived Prisma client (not the backend's — this
    // one) still holds connections from before Postgres was stopped;
    // Postgres restarting is a brand new server process, so those are
    // dead. Force a fresh pool rather than let the next query surface
    // that as a P1017, which isn't the thing this test is verifying.
    await prisma.$disconnect();
    await prisma.$connect();

    // --- State was never corrupted by the failed attempt ---
    const after = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(after.state).toBe("OPEN"); // exactly what it was before the outage — no partial transition
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    // --- The same transition, retried post-recovery, now succeeds — no manual intervention ---
    const recoveredTransition = await transitionIncident(
      workItemId,
      "INVESTIGATING",
      "chaos-test",
      10_000,
    );
    expect(recoveredTransition.status).toBe(200);
    const finalState = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(finalState.state).toBe("INVESTIGATING");

    // --- The signal accepted during the outage eventually produces a real work item too ---
    await waitForWorkItemByComponent(prisma, `${RUN_TAG}-during-outage-component`, 30_000);
  }, 150_000);
});

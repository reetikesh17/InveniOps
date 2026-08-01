// Concurrency E2E test — fires many simultaneous transition requests
// against the same work item and asserts the optimistic-concurrency
// guard (PostgresWorkItemRepository.transitionState's guarded UPDATE —
// see its own comment on why two concurrent callers can never both
// succeed) holds under real concurrent HTTP load, not just in a
// single-process unit test. Run across many iterations, each against a
// freshly created work item, specifically because a race that only
// sometimes manifests would otherwise pass by luck on a single trial.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Db } from "mongodb";
import { postSignals, transitionIncident, type SignalInput } from "./helpers/apiClient.js";
import { makePrismaClient, makeMongoDb } from "./helpers/dataClients.js";
import { waitFor } from "./helpers/wait.js";

const RUN_TAG = `e2e-concurrency-${Date.now()}`;
const ITERATIONS = 25;
const CONCURRENT_REQUESTS = 50;

let prisma: PrismaClient;
let mongoDb: Db;
let closeMongo: () => Promise<void>;
const componentIds = Array.from({ length: ITERATIONS }, (_, i) => `${RUN_TAG}-${i}`);
const workItemIdByComponentId = new Map<string, string>();

describe("E2E: concurrent transitions on one work item", () => {
  beforeAll(async () => {
    prisma = makePrismaClient();
    const mongo = await makeMongoDb();
    mongoDb = mongo.db;
    closeMongo = mongo.close;

    // One signal per component — cost 25, comfortably under the real
    // per-IP rate limiter's default capacity (50), so this is a single
    // request, no chunking/retry needed.
    const signals: SignalInput[] = componentIds.map((componentId) => ({
      signalId: `${componentId}-seed-${randomUUID()}`,
      componentId,
      componentType: "API",
      severity: "P2",
      rawPayload: { e2e: "concurrency-seed" },
      occurredAt: new Date().toISOString(),
    }));
    const result = await postSignals(signals);
    expect(result.status).toBe(202);
    expect(result.accepted).toBe(ITERATIONS);

    await waitFor(
      async () => {
        const count = await prisma.workItem.count({ where: { componentId: { in: componentIds } } });
        return count === ITERATIONS;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        description: `all ${ITERATIONS} seed work items to be created`,
      },
    );

    const workItems = await prisma.workItem.findMany({
      where: { componentId: { in: componentIds } },
    });
    for (const workItem of workItems) {
      workItemIdByComponentId.set(workItem.componentId, workItem.id);
    }
    expect(workItemIdByComponentId.size).toBe(ITERATIONS);
  }, 90_000);

  afterAll(async () => {
    const workItemIds = [...workItemIdByComponentId.values()];
    await prisma.stateTransition.deleteMany({ where: { workItemId: { in: workItemIds } } });
    await prisma.workItem.deleteMany({ where: { id: { in: workItemIds } } });
    await mongoDb.collection("signals").deleteMany({ componentId: { $in: componentIds } });
    await prisma.$disconnect();
    await closeMongo();
  }, 30_000);

  it(`exactly one of ${CONCURRENT_REQUESTS} simultaneous transitions succeeds, across ${ITERATIONS} independent iterations`, async () => {
    const perIterationResults: { successes: number; conflicts: number; other: number[] }[] = [];

    for (const componentId of componentIds) {
      const workItemId = workItemIdByComponentId.get(componentId)!;

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
          transitionIncident(workItemId, "INVESTIGATING", `racer-${i}`),
        ),
      );

      const statuses = responses.map((r) => r.status);
      const successes = statuses.filter((s) => s === 200).length;
      const conflicts = statuses.filter((s) => s === 409).length;
      const other = statuses.filter((s) => s !== 200 && s !== 409);
      perIterationResults.push({ successes, conflicts, other });
    }

    // Asserted after collecting every iteration (not inside the loop) so
    // a single failure reports the full picture across all iterations —
    // a race that only shows up 1 time in 25 is exactly the failure mode
    // this test exists to catch, and a single aggregate assertion makes
    // that visible instead of stopping at the first failing iteration.
    const failing = perIterationResults
      .map((r, i) => ({ ...r, iteration: i, componentId: componentIds[i] }))
      .filter(
        (r) => r.successes !== 1 || r.conflicts !== CONCURRENT_REQUESTS - 1 || r.other.length > 0,
      );

    expect(
      failing,
      `iterations where concurrency control didn't hold: ${JSON.stringify(failing)}`,
    ).toEqual([]);

    // Confirm the state itself, not just the HTTP responses: exactly one
    // work item actually reached INVESTIGATING, and its state didn't
    // regress or get corrupted by the losing 49 attempts.
    const finalStates = await prisma.workItem.findMany({
      where: { id: { in: [...workItemIdByComponentId.values()] } },
      select: { state: true },
    });
    expect(finalStates.every((w) => w.state === "INVESTIGATING")).toBe(true);
  }, 120_000);
});

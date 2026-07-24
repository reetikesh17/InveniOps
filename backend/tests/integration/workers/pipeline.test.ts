import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient, ComponentType, Severity } from "@prisma/client";
import { MongoClient, type Db } from "mongodb";
import { Redis } from "ioredis";
import { createApp } from "../../../src/api/app.js";
import { connectClients, disconnectClients } from "../../../src/repositories/clients.js";
import { signalBuffer } from "../../../src/services/ingestion/signalBufferInstance.js";
import { startWorkerSystem, stopWorkerSystem, type WorkerSystem } from "../../../src/workers/index.js";
import { DashboardCacheRepository } from "../../../src/repositories/redis/dashboardCache.js";
import { TEST_DATABASE_URL, TEST_MONGODB_URI, TEST_REDIS_URL } from "../testEnv.js";

const RUN_ID = randomUUID();
const COMPONENT_PREFIX = `PIPELINE_TEST_${RUN_ID}_`;
const COMPONENT_COUNT = 20;
const TOTAL_SIGNALS = 10_000;
const BATCH_SIZE = 500; // matches the default INGESTION_MAX_BATCH_SIZE

function componentIdFor(index: number): string {
  return `${COMPONENT_PREFIX}COMPONENT_${index % COMPONENT_COUNT}`;
}

// Separate client, pointed at TEST_DATABASE_URL/TEST_MONGODB_URI, purely
// for assertions and cleanup — deliberately not the same PrismaClient
// instance the app/worker use internally (that one is wired from
// DATABASE_URL via repositories/clients.ts, which setupEnv.ts points at
// the same database, so both see the same rows either way).
const assertionPrisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const assertionMongoClient = new MongoClient(TEST_MONGODB_URI);
const assertionRedis = new Redis(TEST_REDIS_URL);
const assertionCache = new DashboardCacheRepository(assertionRedis, 3600);
let assertionDb: Db;

let server: Server;
let baseUrl: string;
let workerSystem: WorkerSystem;

beforeAll(async () => {
  await connectClients();
  await assertionMongoClient.connect();
  assertionDb = assertionMongoClient.db();

  workerSystem = await startWorkerSystem();
  signalBuffer.setSink(workerSystem.sink);
  signalBuffer.start();

  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  signalBuffer.stop();
  await stopWorkerSystem(workerSystem, 10_000);
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  // Fetched before the Postgres delete below specifically to evict these
  // from the Redis dashboard cache too — every one of these 20 work items
  // was created through the real HTTP path, which write-throughs into
  // dashboard:active_incidents (see docs/data-model.md), so deleting only
  // from Postgres/Mongo leaves 20 ghost entries behind every run.
  const createdWorkItemIds = await assertionPrisma.workItem.findMany({
    where: { componentId: { startsWith: COMPONENT_PREFIX } },
    select: { id: true },
  });
  await Promise.all(createdWorkItemIds.map(({ id }) => assertionCache.removeIncident(id)));

  await assertionPrisma.workItem.deleteMany({ where: { componentId: { startsWith: COMPONENT_PREFIX } } });
  await assertionDb.collection("signals").deleteMany({ componentId: { $regex: `^${COMPONENT_PREFIX}` } });
  // signal_volume_metrics carries componentId as a dim, so this run's
  // contribution is cleanly identifiable — workitem_created_metrics
  // doesn't (by design, see docs/data-model.md), so its handful of
  // CACHE/P2 points from this run are left for the collection's own TTL
  // to expire, same as any other real aggregation write would be.
  await assertionDb.collection("signal_volume_metrics").deleteMany({ "dims.componentId": { $regex: `^${COMPONENT_PREFIX}` } });

  await assertionPrisma.$disconnect();
  await assertionMongoClient.close();
  await assertionRedis.quit();
  await disconnectClients();
}, 30_000);

function makeSignalPayload(index: number): Record<string, unknown> {
  return {
    componentId: componentIdFor(index),
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    rawPayload: { index },
    occurredAt: new Date().toISOString(),
  };
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

describe("full write path: HTTP -> buffer -> queue -> worker -> debouncer -> stores -> cache", () => {
  it(
    "processes 10,000 signals end to end — all land in Mongo, correctly debounced in Postgres, nothing left in the DLQ",
    async () => {
      const batches: Array<Array<Record<string, unknown>>> = [];
      for (let start = 0; start < TOTAL_SIGNALS; start += BATCH_SIZE) {
        batches.push(Array.from({ length: BATCH_SIZE }, (_, i) => makeSignalPayload(start + i)));
      }

      const responses = await Promise.all(
        batches.map((batch) =>
          fetch(`${baseUrl}/api/v1/signals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch),
          }),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(202);
      }

      const signalFilter = { componentId: { $regex: `^${COMPONENT_PREFIX}` } };

      // Ingestion is async past the 202 — poll until the worker system has
      // actually drained the buffer, processed every queued batch, and
      // persisted everything.
      await waitUntil(
        async () => (await assertionDb.collection("signals").countDocuments(signalFilter)) >= TOTAL_SIGNALS,
        60_000,
      );

      const totalMongoDocs = await assertionDb.collection("signals").countDocuments(signalFilter);
      expect(totalMongoDocs).toBe(TOTAL_SIGNALS);

      const withoutWorkItem = await assertionDb
        .collection("signals")
        .countDocuments({ ...signalFilter, workItemId: null });
      expect(withoutWorkItem).toBe(0);

      // Debouncing: 10,000 signals across 20 distinct components, all
      // arriving well within the debounce window, must collapse to
      // exactly one work item per component — not 10,000, not more than
      // COMPONENT_COUNT.
      const workItems = await assertionPrisma.workItem.findMany({
        where: { componentId: { startsWith: COMPONENT_PREFIX } },
      });
      expect(workItems).toHaveLength(COMPONENT_COUNT);

      const totalSignalCount = workItems.reduce((sum, workItem) => sum + workItem.signalCount, 0);
      expect(totalSignalCount).toBe(TOTAL_SIGNALS);
      for (const workItem of workItems) {
        expect(workItem.signalCount).toBe(TOTAL_SIGNALS / COMPONENT_COUNT);
      }

      // Nothing exhausted its retries — the whole burst succeeded cleanly.
      const dlqJobCounts = await workerSystem.deadLetterQueue.getJobCounts();
      const dlqSize = Object.values(dlqJobCounts).reduce((sum, count) => sum + count, 0);
      expect(dlqSize).toBe(0);
    },
    120_000,
  );
});

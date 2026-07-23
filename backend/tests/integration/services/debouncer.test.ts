import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, ComponentType, Severity } from "@prisma/client";
import { MongoClient, type Db } from "mongodb";
import { Redis } from "ioredis";
import { PostgresWorkItemRepository } from "../../../src/repositories/postgres/index.js";
import { MongoSignalRepository } from "../../../src/repositories/mongo/index.js";
import { SignalDebouncer, type SignalDebouncerOptions } from "../../../src/services/ingestion/debouncer.js";
import type { IngestionSignal } from "../../../src/services/ingestion/buffer.js";
import { TEST_DATABASE_URL, TEST_MONGODB_URI, TEST_REDIS_URL } from "../testEnv.js";

const COMPONENT_PREFIX = "DEBOUNCE_TEST_";

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const mongoClient = new MongoClient(TEST_MONGODB_URI);
const redis = new Redis(TEST_REDIS_URL);

let db: Db;
let workItemStore: PostgresWorkItemRepository;
let signalStore: MongoSignalRepository;
let debouncer: SignalDebouncer;

const baseOptions: SignalDebouncerOptions = {
  windowSeconds: 10,
  threshold: 100,
  lockTtlMs: 2000,
  lockWaitTimeoutMs: 800,
  lockPollIntervalMs: 10,
};

beforeAll(async () => {
  await prisma.$connect();
  await mongoClient.connect();
  db = mongoClient.db();

  workItemStore = new PostgresWorkItemRepository(prisma);
  signalStore = new MongoSignalRepository(db);
  debouncer = new SignalDebouncer(workItemStore, signalStore, redis, baseOptions);
});

afterAll(async () => {
  await prisma.workItem.deleteMany({ where: { componentId: { startsWith: COMPONENT_PREFIX } } });
  await db.collection("signals").deleteMany({ componentId: { $regex: `^${COMPONENT_PREFIX}` } });

  const debounceKeys = await redis.keys("debounce:*");
  if (debounceKeys.length > 0) {
    await redis.del(...debounceKeys);
  }

  await prisma.$disconnect();
  await mongoClient.close();
  await redis.quit();
});

function makeSignal(componentId: string, overrides: Partial<IngestionSignal> = {}): IngestionSignal {
  const now = new Date();
  return {
    signalId: randomUUID(),
    componentId,
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    rawPayload: { message: "connection refused" },
    occurredAt: now,
    receivedAt: now,
    ...overrides,
  };
}

function freshComponentId(label: string): string {
  return `${COMPONENT_PREFIX}${label}_${randomUUID()}`;
}

async function clearSession(componentId: string): Promise<void> {
  await redis.del(`debounce:session:${componentId}`);
}

describe("SignalDebouncer", () => {
  describe("create vs. link", () => {
    it("creates a work item for the first signal on a component with none active", async () => {
      const componentId = freshComponentId("basic");
      const signal = makeSignal(componentId);

      const result = await debouncer.processSignal(signal);

      expect(result.created).toBe(true);

      const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: result.workItemId } });
      expect(workItem.componentId).toBe(componentId);
      expect(workItem.componentType).toBe(signal.componentType);
      expect(workItem.severity).toBe(signal.severity);
      expect(workItem.state).toBe("OPEN");
      expect(workItem.signalCount).toBe(1);

      const doc = await db.collection("signals").findOne({ signalId: signal.signalId });
      expect(doc?.["workItemId"]).toBe(result.workItemId);
    });

    it("links subsequent signals to the same work item instead of creating a new one", async () => {
      const componentId = freshComponentId("link");

      const first = await debouncer.processSignal(makeSignal(componentId));
      const second = await debouncer.processSignal(makeSignal(componentId));
      const third = await debouncer.processSignal(makeSignal(componentId));

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(third.created).toBe(false);
      expect(second.workItemId).toBe(first.workItemId);
      expect(third.workItemId).toBe(first.workItemId);

      const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: first.workItemId } });
      expect(workItem.signalCount).toBe(3);

      const docs = await db.collection("signals").find({ componentId }).toArray();
      expect(docs).toHaveLength(3);
      expect(docs.every((doc) => doc["workItemId"] === first.workItemId)).toBe(true);
    });

    it("links to an existing RESOLVED (not yet CLOSED) work item rather than creating a duplicate", async () => {
      const componentId = freshComponentId("resolved");

      const first = await debouncer.processSignal(makeSignal(componentId));
      await prisma.workItem.update({ where: { id: first.workItemId }, data: { state: "RESOLVED" } });
      await clearSession(componentId); // force a fresh Postgres lookup, not the cache

      const second = await debouncer.processSignal(makeSignal(componentId));

      expect(second.created).toBe(false);
      expect(second.workItemId).toBe(first.workItemId);

      const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: first.workItemId } });
      expect(workItem.signalCount).toBe(2);
    });

    it("creates a new work item when the existing one for a component is CLOSED", async () => {
      const componentId = freshComponentId("closed");

      const first = await debouncer.processSignal(makeSignal(componentId));
      await prisma.workItem.update({ where: { id: first.workItemId }, data: { state: "CLOSED" } });
      await clearSession(componentId);

      const second = await debouncer.processSignal(makeSignal(componentId));

      expect(second.created).toBe(true);
      expect(second.workItemId).not.toBe(first.workItemId);
    });
  });

  describe("cache staleness bounds (window / threshold)", () => {
    it("re-verifies against Postgres once the debounce window elapses, and still resolves correctly", async () => {
      const componentId = freshComponentId("window");
      const shortWindow = new SignalDebouncer(workItemStore, signalStore, redis, {
        ...baseOptions,
        windowSeconds: 1,
        threshold: 1000,
      });

      const first = await shortWindow.processSignal(makeSignal(componentId));
      expect(first.created).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const second = await shortWindow.processSignal(makeSignal(componentId));
      expect(second.created).toBe(false);
      expect(second.workItemId).toBe(first.workItemId);

      const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: first.workItemId } });
      expect(workItem.signalCount).toBe(2);
    });

    it("re-verifies against Postgres once the signal count exceeds the threshold, and still resolves correctly", async () => {
      const componentId = freshComponentId("threshold");
      const lowThreshold = new SignalDebouncer(workItemStore, signalStore, redis, {
        ...baseOptions,
        windowSeconds: 1000,
        threshold: 2,
      });

      const first = await lowThreshold.processSignal(makeSignal(componentId)); // create, session count seeded to 0
      const second = await lowThreshold.processSignal(makeSignal(componentId)); // fast path, count -> 1
      const third = await lowThreshold.processSignal(makeSignal(componentId)); // fast path, count -> 2
      const fourth = await lowThreshold.processSignal(makeSignal(componentId)); // count(2) >= threshold(2) -> slow path

      for (const result of [second, third, fourth]) {
        expect(result.created).toBe(false);
        expect(result.workItemId).toBe(first.workItemId);
      }

      const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: first.workItemId } });
      expect(workItem.signalCount).toBe(4);
    });
  });

  describe("concurrency", () => {
    it(
      "under heavy concurrent load, creates exactly one work item per component — verified across many iterations",
      async () => {
        const ITERATIONS = 8;
        const CONCURRENT_SIGNALS = 60;

        for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
          const componentId = freshComponentId(`race_${iteration}`);
          const signals = Array.from({ length: CONCURRENT_SIGNALS }, () => makeSignal(componentId));

          const results = await Promise.all(signals.map((signal) => debouncer.processSignal(signal)));

          const createdCount = results.filter((result) => result.created).length;
          expect(createdCount).toBe(1);

          const distinctWorkItemIds = new Set(results.map((result) => result.workItemId));
          expect(distinctWorkItemIds.size).toBe(1);

          const activeWorkItems = await prisma.workItem.findMany({ where: { componentId } });
          expect(activeWorkItems).toHaveLength(1);
          expect(activeWorkItems[0]?.signalCount).toBe(CONCURRENT_SIGNALS);

          const mongoDocs = await db.collection("signals").find({ componentId }).toArray();
          expect(mongoDocs).toHaveLength(CONCURRENT_SIGNALS);
          const mongoWorkItemIds = new Set(mongoDocs.map((doc): string => String(doc["workItemId"])));
          expect(mongoWorkItemIds.size).toBe(1);
          expect([...mongoWorkItemIds][0]).toBe(activeWorkItems[0]?.id);
        }
      },
      60_000,
    );
  });
});

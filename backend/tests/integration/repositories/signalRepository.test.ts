import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { MongoSignalRepository, type SignalDocument } from "../../../src/repositories/mongo/index.js";
import { TEST_MONGODB_URI } from "../testEnv.js";

let client: MongoClient;
let db: Db;
let repo: MongoSignalRepository;

beforeAll(async () => {
  client = new MongoClient(TEST_MONGODB_URI);
  await client.connect();
  db = client.db();
  repo = new MongoSignalRepository(db);
  // Index provisioning is a separate deliverable (not part of this
  // repository layer) — created here only so the ordered:false test below
  // has a real constraint to violate.
  await db.collection("signals").createIndex({ signalId: 1 }, { unique: true });
});

// Both directions: beforeEach so this file doesn't depend on inheriting a
// pristine collection from whatever integration test file happened to run
// before it (this file's own assertions are unscoped countDocuments({})
// calls), afterEach so it doesn't leave anything behind for whatever runs
// after it either.
beforeEach(async () => {
  await db.collection("signals").deleteMany({});
});

afterEach(async () => {
  await db.collection("signals").deleteMany({});
});

afterAll(async () => {
  await client.close();
});

function makeSignal(overrides: Partial<SignalDocument> = {}): SignalDocument {
  return {
    signalId: randomUUID(),
    componentId: "CACHE_CLUSTER_01",
    componentType: "CACHE",
    severity: "P2",
    rawPayload: { message: "connection refused" },
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    workItemId: null,
    ...overrides,
  };
}

describe("MongoSignalRepository", () => {
  describe("insertMany", () => {
    it("inserts a batch in one call", async () => {
      const signals = [makeSignal(), makeSignal(), makeSignal()];

      await repo.insertMany(signals);

      const count = await db.collection("signals").countDocuments({});
      expect(count).toBe(3);
    });

    it("is a no-op for an empty batch", async () => {
      await expect(repo.insertMany([])).resolves.toBeUndefined();
      expect(await db.collection("signals").countDocuments({})).toBe(0);
    });

    it("persists the rest of the batch when one document violates a unique constraint (ordered: false)", async () => {
      const existing = makeSignal();
      await repo.insertMany([existing]);

      const duplicate = makeSignal({ signalId: existing.signalId });
      const valid = makeSignal();

      await expect(repo.insertMany([duplicate, valid])).rejects.toThrow();

      const remaining = await db.collection("signals").find({}).toArray();
      const signalIds = remaining.map((doc) => doc["signalId"] as string);
      expect(signalIds).toContain(valid.signalId);
      expect(signalIds.filter((id) => id === existing.signalId)).toHaveLength(1);
    });
  });

  describe("findByWorkItemId", () => {
    it("returns signals chronologically and respects pagination", async () => {
      const workItemId = randomUUID();
      const signals = [0, 1, 2, 3, 4].map((i) =>
        makeSignal({ workItemId, receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) }),
      );
      await repo.insertMany(signals);

      const page1 = await repo.findByWorkItemId(workItemId, { limit: 2, offset: 0 });
      const page2 = await repo.findByWorkItemId(workItemId, { limit: 2, offset: 2 });

      expect(page1.map((s) => s.signalId)).toEqual([signals[0]?.signalId, signals[1]?.signalId]);
      expect(page2.map((s) => s.signalId)).toEqual([signals[2]?.signalId, signals[3]?.signalId]);
    });

    it("does not return signals belonging to a different work item", async () => {
      const workItemId = randomUUID();
      await repo.insertMany([makeSignal({ workItemId }), makeSignal({ workItemId: randomUUID() })]);

      const results = await repo.findByWorkItemId(workItemId, { limit: 10, offset: 0 });

      expect(results).toHaveLength(1);
      expect(results[0]?.workItemId).toBe(workItemId);
    });
  });

  describe("findByComponentInWindow", () => {
    it("returns only signals within the given time window", async () => {
      const componentId = "CACHE_CLUSTER_02";
      await repo.insertMany([
        makeSignal({ componentId, receivedAt: new Date("2026-01-01T00:00:00.000Z") }), // before window
        makeSignal({ componentId, receivedAt: new Date("2026-01-01T12:00:00.000Z") }), // in window
        makeSignal({ componentId, receivedAt: new Date("2026-01-02T00:00:00.000Z") }), // after window
      ]);

      const results = await repo.findByComponentInWindow(
        componentId,
        new Date("2026-01-01T06:00:00.000Z"),
        new Date("2026-01-01T18:00:00.000Z"),
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.receivedAt).toEqual(new Date("2026-01-01T12:00:00.000Z"));
    });
  });

  describe("countByWorkItemId", () => {
    it("counts signals linked to a work item", async () => {
      const workItemId = randomUUID();
      await repo.insertMany([makeSignal({ workItemId }), makeSignal({ workItemId }), makeSignal({ workItemId: null })]);

      expect(await repo.countByWorkItemId(workItemId)).toBe(2);
    });
  });
});

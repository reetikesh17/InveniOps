import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMetricsRepository } from "../../../src/repositories/metrics/index.js";
import { TEST_MONGODB_URI } from "../testEnv.js";

const COLLECTION_NAMES = [
  "signal_volume_metrics",
  "workitem_created_metrics",
  "state_transition_metrics",
  "mttr_metrics",
  "alert_dispatch_metrics",
] as const;

let client: MongoClient;
let db: Db;
let repo: MongoMetricsRepository;

beforeAll(async () => {
  client = new MongoClient(TEST_MONGODB_URI);
  await client.connect();
  db = client.db();
  repo = new MongoMetricsRepository(db);
  await repo.ensureCollections();
});

// Time-series collections don't support arbitrary deleteMany the way a
// normal collection does in every server version — drop and let the next
// ensureCollections() (called per test via beforeAll's repo) recreate them
// is the reliable way to isolate tests from each other.
afterEach(async () => {
  for (const name of COLLECTION_NAMES) {
    await db.collection(name).drop().catch(() => undefined);
  }
  await repo.ensureCollections();
});

afterAll(async () => {
  await client.close();
});

describe("MongoMetricsRepository", () => {
  describe("ensureCollections", () => {
    it("is idempotent — calling it again does not throw", async () => {
      await expect(repo.ensureCollections()).resolves.toBeUndefined();
      await expect(repo.ensureCollections()).resolves.toBeUndefined();
    });

    it("creates all five series as native time-series collections", async () => {
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      const names = new Set(collections.map((c) => c.name));
      for (const name of COLLECTION_NAMES) {
        expect(names.has(name)).toBe(true);
      }
    });
  });

  describe("queryThroughput", () => {
    it("aggregates a known fixture dataset into per-minute, per-(componentId,severity) buckets", async () => {
      const base = new Date("2026-01-01T00:00:00.000Z");
      await repo.recordSignalVolume([
        { ts: new Date(base.getTime()), componentId: "C1", severity: "P1", count: 3 },
        { ts: new Date(base.getTime() + 10_000), componentId: "C1", severity: "P1", count: 2 }, // same minute, same dims -> sums with the row above
        { ts: new Date(base.getTime() + 20_000), componentId: "C1", severity: "P2", count: 1 }, // same minute, different severity -> separate bucket
        { ts: new Date(base.getTime() + 60_000), componentId: "C1", severity: "P1", count: 7 }, // next minute
        { ts: new Date(base.getTime() + 5_000), componentId: "C2", severity: "P1", count: 4 }, // different component
      ]);

      const result = await repo.queryThroughput(
        base,
        new Date(base.getTime() + 120_000),
        { unit: "minute", binSize: 1 },
      );

      expect(result).toEqual([
        { bucket: base, componentId: "C1", severity: "P1", count: 5 },
        { bucket: base, componentId: "C1", severity: "P2", count: 1 },
        { bucket: base, componentId: "C2", severity: "P1", count: 4 },
        { bucket: new Date(base.getTime() + 60_000), componentId: "C1", severity: "P1", count: 7 },
      ]);
    });

    it("bucket boundaries: [from, to) — a point exactly at `to` is excluded, a point exactly at `from` is included", async () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const to = new Date("2026-01-01T00:02:00.000Z");
      await repo.recordSignalVolume([
        { ts: new Date(from.getTime() - 1), componentId: "C1", severity: "P1", count: 100 }, // just before `from` -> excluded
        { ts: from, componentId: "C1", severity: "P1", count: 1 }, // exactly `from` -> included
        { ts: to, componentId: "C1", severity: "P1", count: 200 }, // exactly `to` -> excluded
        { ts: new Date(to.getTime() - 1), componentId: "C1", severity: "P1", count: 1 }, // just before `to` -> included, buckets into minute 1
      ]);

      const result = await repo.queryThroughput(from, to, { unit: "minute", binSize: 1 });

      const total = result.reduce((sum, bucket) => sum + bucket.count, 0);
      expect(total).toBe(2);
      expect(result).toEqual(
        expect.arrayContaining([
          { bucket: from, componentId: "C1", severity: "P1", count: 1 },
          { bucket: new Date("2026-01-01T00:01:00.000Z"), componentId: "C1", severity: "P1", count: 1 },
        ]),
      );
    });

    it("a point exactly on a minute boundary buckets forward, not into the preceding minute", async () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const boundary = new Date("2026-01-01T00:01:00.000Z");
      await repo.recordSignalVolume([{ ts: boundary, componentId: "C1", severity: "P1", count: 9 }]);

      const result = await repo.queryThroughput(from, new Date(from.getTime() + 120_000), { unit: "minute", binSize: 1 });

      expect(result).toEqual([{ bucket: boundary, componentId: "C1", severity: "P1", count: 9 }]);
    });

    it("empty-range behaviour: a range with no matching data returns an empty array, not an error", async () => {
      await repo.recordSignalVolume([{ ts: new Date("2026-01-01T00:00:00.000Z"), componentId: "C1", severity: "P1", count: 1 }]);

      const result = await repo.queryThroughput(
        new Date("2099-01-01T00:00:00.000Z"),
        new Date("2099-01-02T00:00:00.000Z"),
        { unit: "hour", binSize: 1 },
      );

      expect(result).toEqual([]);
    });

    it("empty-range behaviour: an inverted range (from >= to) returns an empty array", async () => {
      const t = new Date("2026-01-01T00:00:00.000Z");
      await repo.recordSignalVolume([{ ts: t, componentId: "C1", severity: "P1", count: 1 }]);

      const result = await repo.queryThroughput(t, t, { unit: "minute", binSize: 1 });

      expect(result).toEqual([]);
    });
  });

  describe("queryIncidentCounts", () => {
    it("groups by the requested dimension and sums correctly", async () => {
      const base = new Date("2026-01-01T00:00:00.000Z");
      await repo.recordWorkItemsCreated([
        { ts: base, componentType: "RDBMS", severity: "P0" },
        { ts: new Date(base.getTime() + 1_000), componentType: "RDBMS", severity: "P0" },
        { ts: new Date(base.getTime() + 2_000), componentType: "CACHE", severity: "P2" },
      ]);

      const byComponentType = await repo.queryIncidentCounts(
        base,
        new Date(base.getTime() + 60_000),
        { unit: "minute", binSize: 1 },
        "componentType",
      );
      const bySeverity = await repo.queryIncidentCounts(
        base,
        new Date(base.getTime() + 60_000),
        { unit: "minute", binSize: 1 },
        "severity",
      );

      expect(byComponentType).toEqual(
        expect.arrayContaining([
          { bucket: base, value: "RDBMS", count: 2 },
          { bucket: base, value: "CACHE", count: 1 },
        ]),
      );
      expect(bySeverity).toEqual(
        expect.arrayContaining([
          { bucket: base, value: "P0", count: 2 },
          { bucket: base, value: "P2", count: 1 },
        ]),
      );
    });
  });

  describe("queryMttrTrend", () => {
    it("computes a per-bucket average plus a trailing rolling average, server-side", async () => {
      const day = (n: number): Date => new Date(Date.UTC(2026, 0, 1 + n));
      // Five consecutive daily buckets for RDBMS: avgMttrMs = 1000, 2000, 3000, 4000, 5000
      await repo.recordMttr([
        { ts: day(0), componentType: "RDBMS", severity: "P0", componentId: "R1", mttrMs: 1_000 },
        { ts: day(1), componentType: "RDBMS", severity: "P0", componentId: "R1", mttrMs: 2_000 },
        { ts: day(2), componentType: "RDBMS", severity: "P0", componentId: "R1", mttrMs: 3_000 },
        { ts: day(3), componentType: "RDBMS", severity: "P0", componentId: "R1", mttrMs: 4_000 },
        { ts: day(4), componentType: "RDBMS", severity: "P0", componentId: "R1", mttrMs: 5_000 },
      ]);

      const trend = await repo.queryMttrTrend(day(0), new Date(day(4).getTime() + 1), { unit: "day", binSize: 1 }, "componentType");

      expect(trend).toHaveLength(5);
      expect(trend.map((b) => b.avgMttrMs)).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
      // Rolling window is [-4, 0] buckets — by the 5th bucket, all 5 prior
      // averages are in view: mean(1000..5000) = 3000.
      expect(trend[4]?.rollingAvgMttrMs).toBe(3_000);
      // The very first bucket's rolling average has only itself in the window.
      expect(trend[0]?.rollingAvgMttrMs).toBe(1_000);
    });
  });

  describe("queryComponentHealth", () => {
    it("sums recent signal volume and averages MTTR, scoped to one componentId", async () => {
      const now = new Date();
      const recentSince = new Date(now.getTime() - 60_000);
      await repo.recordSignalVolume([
        { ts: now, componentId: "TARGET", severity: "P1", count: 5 },
        { ts: now, componentId: "OTHER", severity: "P1", count: 999 },
      ]);
      await repo.recordMttr([
        { ts: now, componentType: "CACHE", severity: "P2", componentId: "TARGET", mttrMs: 1_000 },
        { ts: now, componentType: "CACHE", severity: "P2", componentId: "TARGET", mttrMs: 3_000 },
        { ts: now, componentType: "CACHE", severity: "P2", componentId: "OTHER", mttrMs: 999_000 },
      ]);

      const result = await repo.queryComponentHealth("TARGET", recentSince);

      expect(result).toEqual({ recentSignalCount: 5, avgMttrMs: 2_000 });
    });

    it("returns zero/null for a component with no data, not an error", async () => {
      const result = await repo.queryComponentHealth("NEVER_SEEN", new Date(Date.now() - 60_000));
      expect(result).toEqual({ recentSignalCount: 0, avgMttrMs: null });
    });
  });
});

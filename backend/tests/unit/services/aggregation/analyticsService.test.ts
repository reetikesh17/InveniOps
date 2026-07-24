import { describe, expect, it } from "vitest";
import {
  AnalyticsQueryService,
  type ComponentWorkItemStore,
  type MetricsQueryStore,
} from "../../../../src/services/aggregation/analyticsService.js";
import type {
  BucketSpec,
  ComponentHealthAggregate,
  GroupedCountBucket,
  IncidentGroupBy,
  MttrTrendBucket,
  ThroughputBucket,
} from "../../../../src/repositories/metrics/index.js";

function fakeMetricsStore(overrides: Partial<MetricsQueryStore> = {}): MetricsQueryStore {
  return {
    queryThroughput: (): Promise<ThroughputBucket[]> => Promise.resolve([]),
    queryIncidentCounts: (): Promise<GroupedCountBucket[]> => Promise.resolve([]),
    queryMttrTrend: (): Promise<MttrTrendBucket[]> => Promise.resolve([]),
    queryComponentHealth: (): Promise<ComponentHealthAggregate> => Promise.resolve({ recentSignalCount: 0, avgMttrMs: null }),
    ...overrides,
  };
}

function fakeWorkItemStore(counts: Readonly<Record<string, number>> = {}): ComponentWorkItemStore {
  return { countByComponentIdGroupedByState: (): Promise<Readonly<Record<string, number>>> => Promise.resolve(counts) };
}

const FROM = new Date("2026-01-01T00:00:00.000Z");
const TO = new Date("2026-01-01T01:00:00.000Z");

describe("AnalyticsQueryService", () => {
  it("getThroughput: converts the interval to a bucket spec and serializes bucket Dates to ISO strings", async () => {
    let receivedInterval: BucketSpec | undefined;
    const store = fakeMetricsStore({
      queryThroughput: (from, to, interval): Promise<ThroughputBucket[]> => {
        receivedInterval = interval;
        return Promise.resolve([{ bucket: new Date("2026-01-01T00:05:00.000Z"), componentId: "c1", severity: "P1", count: 4 }]);
      },
    });
    const service = new AnalyticsQueryService(store, fakeWorkItemStore());

    const result = await service.getThroughput(FROM, TO, 300);

    expect(receivedInterval).toEqual({ unit: "minute", binSize: 5 });
    expect(result).toEqual({
      from: FROM.toISOString(),
      to: TO.toISOString(),
      intervalSeconds: 300,
      points: [{ bucket: "2026-01-01T00:05:00.000Z", componentId: "c1", severity: "P1", count: 4 }],
    });
  });

  it("getIncidentCounts: passes groupBy through and shapes the DTO", async () => {
    let receivedGroupBy: IncidentGroupBy | undefined;
    const store = fakeMetricsStore({
      queryIncidentCounts: (from, to, interval, groupBy): Promise<GroupedCountBucket[]> => {
        receivedGroupBy = groupBy;
        return Promise.resolve([{ bucket: FROM, value: "RDBMS", count: 2 }]);
      },
    });
    const service = new AnalyticsQueryService(store, fakeWorkItemStore());

    const result = await service.getIncidentCounts(FROM, TO, 3_600, "componentType");

    expect(receivedGroupBy).toBe("componentType");
    expect(result.groupBy).toBe("componentType");
    expect(result.points).toEqual([{ bucket: FROM.toISOString(), value: "RDBMS", count: 2 }]);
  });

  it("getMttrTrend: shapes rolling-average points into the DTO", async () => {
    const store = fakeMetricsStore({
      queryMttrTrend: (): Promise<MttrTrendBucket[]> =>
        Promise.resolve([{ bucket: FROM, value: "P0", avgMttrMs: 5_000, rollingAvgMttrMs: 4_500, sampleCount: 3 }]),
    });
    const service = new AnalyticsQueryService(store, fakeWorkItemStore());

    const result = await service.getMttrTrend(FROM, TO, 3_600, "severity");

    expect(result.points).toEqual([{ bucket: FROM.toISOString(), value: "P0", avgMttrMs: 5_000, rollingAvgMttrMs: 4_500, sampleCount: 3 }]);
  });

  it("getComponentHealth: composes the Mongo aggregate with the Postgres state breakdown", async () => {
    const store = fakeMetricsStore({
      queryComponentHealth: (componentId, recentSince): Promise<ComponentHealthAggregate> => {
        expect(componentId).toBe("RDBMS_01");
        expect(recentSince.getTime()).toBeLessThan(Date.now());
        return Promise.resolve({ recentSignalCount: 42, avgMttrMs: 12_000 });
      },
    });
    const workItemStore = fakeWorkItemStore({ OPEN: 1, INVESTIGATING: 2 });
    const service = new AnalyticsQueryService(store, workItemStore);

    const result = await service.getComponentHealth("RDBMS_01", 3_600);

    expect(result).toEqual({
      componentId: "RDBMS_01",
      windowSeconds: 3_600,
      recentSignalCount: 42,
      avgMttrMs: 12_000,
      openWorkItemsByState: { OPEN: 1, INVESTIGATING: 2 },
    });
  });
});

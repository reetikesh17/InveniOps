import type {
  BucketSpec,
  ComponentHealthAggregate,
  GroupedCountBucket,
  IncidentGroupBy,
  MttrTrendBucket,
  ThroughputBucket,
} from "../../repositories/metrics/index.js";
import { toBucketSpec } from "../../repositories/metrics/index.js";

// Narrow, structural interfaces — MongoMetricsRepository and
// PostgresWorkItemRepository satisfy these without an adapter; tests can
// substitute fakes with zero real Postgres/Mongo.
export interface MetricsQueryStore {
  queryThroughput(from: Date, to: Date, interval: BucketSpec): Promise<ThroughputBucket[]>;
  queryIncidentCounts(from: Date, to: Date, interval: BucketSpec, groupBy: IncidentGroupBy): Promise<GroupedCountBucket[]>;
  queryMttrTrend(from: Date, to: Date, interval: BucketSpec, groupBy: IncidentGroupBy): Promise<MttrTrendBucket[]>;
  queryComponentHealth(componentId: string, recentSince: Date): Promise<ComponentHealthAggregate>;
}

export interface ComponentWorkItemStore {
  countByComponentIdGroupedByState(componentId: string): Promise<Readonly<Record<string, number>>>;
}

export interface ThroughputPointDto {
  readonly bucket: string;
  readonly componentId: string;
  readonly severity: string;
  readonly count: number;
}

export interface ThroughputResponseDto {
  readonly from: string;
  readonly to: string;
  readonly intervalSeconds: number;
  readonly points: readonly ThroughputPointDto[];
}

export interface GroupedCountPointDto {
  readonly bucket: string;
  readonly value: string;
  readonly count: number;
}

export interface IncidentCountsResponseDto {
  readonly from: string;
  readonly to: string;
  readonly intervalSeconds: number;
  readonly groupBy: IncidentGroupBy;
  readonly points: readonly GroupedCountPointDto[];
}

export interface MttrTrendPointDto {
  readonly bucket: string;
  readonly value: string;
  readonly avgMttrMs: number;
  readonly rollingAvgMttrMs: number;
  readonly sampleCount: number;
}

export interface MttrTrendResponseDto {
  readonly from: string;
  readonly to: string;
  readonly intervalSeconds: number;
  readonly groupBy: IncidentGroupBy;
  readonly points: readonly MttrTrendPointDto[];
}

export interface ComponentHealthDto {
  readonly componentId: string;
  readonly windowSeconds: number;
  readonly recentSignalCount: number;
  readonly avgMttrMs: number | null;
  readonly openWorkItemsByState: Readonly<Record<string, number>>;
}

/**
 * Thin orchestration layer for src/api/routes/analytics.ts: validates
 * nothing (the route does that), just turns already-validated query params
 * into store calls and shapes the result into a DTO. All bucketing happens
 * inside the store's aggregation pipeline (see metricsRepository.ts) — this
 * class never iterates raw points to compute a bucket or an average itself.
 */
export class AnalyticsQueryService {
  constructor(
    private readonly metricsStore: MetricsQueryStore,
    private readonly workItemStore: ComponentWorkItemStore,
  ) {}

  async getThroughput(from: Date, to: Date, intervalSeconds: number): Promise<ThroughputResponseDto> {
    const buckets = await this.metricsStore.queryThroughput(from, to, toBucketSpec(intervalSeconds));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      intervalSeconds,
      points: buckets.map((bucket) => ({
        bucket: bucket.bucket.toISOString(),
        componentId: bucket.componentId,
        severity: bucket.severity,
        count: bucket.count,
      })),
    };
  }

  async getIncidentCounts(
    from: Date,
    to: Date,
    intervalSeconds: number,
    groupBy: IncidentGroupBy,
  ): Promise<IncidentCountsResponseDto> {
    const buckets = await this.metricsStore.queryIncidentCounts(from, to, toBucketSpec(intervalSeconds), groupBy);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      intervalSeconds,
      groupBy,
      points: buckets.map((bucket) => ({ bucket: bucket.bucket.toISOString(), value: bucket.value, count: bucket.count })),
    };
  }

  async getMttrTrend(
    from: Date,
    to: Date,
    intervalSeconds: number,
    groupBy: IncidentGroupBy,
  ): Promise<MttrTrendResponseDto> {
    const buckets = await this.metricsStore.queryMttrTrend(from, to, toBucketSpec(intervalSeconds), groupBy);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      intervalSeconds,
      groupBy,
      points: buckets.map((bucket) => ({
        bucket: bucket.bucket.toISOString(),
        value: bucket.value,
        avgMttrMs: bucket.avgMttrMs,
        rollingAvgMttrMs: bucket.rollingAvgMttrMs,
        sampleCount: bucket.sampleCount,
      })),
    };
  }

  async getComponentHealth(componentId: string, windowSeconds: number): Promise<ComponentHealthDto> {
    const recentSince = new Date(Date.now() - windowSeconds * 1000);
    const [aggregate, openWorkItemsByState] = await Promise.all([
      this.metricsStore.queryComponentHealth(componentId, recentSince),
      this.workItemStore.countByComponentIdGroupedByState(componentId),
    ]);
    return {
      componentId,
      windowSeconds,
      recentSignalCount: aggregate.recentSignalCount,
      avgMttrMs: aggregate.avgMttrMs,
      openWorkItemsByState,
    };
  }
}

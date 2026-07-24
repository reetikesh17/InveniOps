import type { Severity, WorkItemState } from "./enums";

export type AnalyticsGroupBy = "componentType" | "severity";

export interface ThroughputQuery {
  readonly from: string;
  readonly to: string;
  readonly interval?: number;
}

export interface GroupedAnalyticsQuery extends ThroughputQuery {
  readonly groupBy?: AnalyticsGroupBy;
}

// Mirrors backend src/services/aggregation/analyticsService.ts's DTOs
// exactly — see GET /api/v1/analytics/{throughput,incidents,mttr}.
export interface ThroughputPoint {
  readonly bucket: string;
  readonly componentId: string;
  readonly severity: Severity;
  readonly count: number;
}

export interface ThroughputResponse {
  readonly from: string;
  readonly to: string;
  readonly intervalSeconds: number;
  readonly points: readonly ThroughputPoint[];
}

export interface GroupedCountPoint {
  readonly bucket: string;
  readonly value: string;
  readonly count: number;
}

export interface IncidentCountsResponse {
  readonly from: string;
  readonly to: string;
  readonly intervalSeconds: number;
  readonly groupBy: AnalyticsGroupBy;
  readonly points: readonly GroupedCountPoint[];
}

export interface MttrTrendPoint {
  readonly bucket: string;
  readonly value: string;
  readonly avgMttrMs: number;
  readonly rollingAvgMttrMs: number;
  readonly sampleCount: number;
}

export interface MttrTrendResponse {
  readonly from: string;
  readonly to: string;
  readonly intervalSeconds: number;
  readonly groupBy: AnalyticsGroupBy;
  readonly points: readonly MttrTrendPoint[];
}

export interface ComponentHealth {
  readonly componentId: string;
  readonly windowSeconds: number;
  readonly recentSignalCount: number;
  readonly avgMttrMs: number | null;
  readonly openWorkItemsByState: Readonly<Partial<Record<WorkItemState, number>>>;
}

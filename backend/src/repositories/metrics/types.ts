// The write-side shapes callers (processBatch.ts, workflowService.ts,
// dispatcher.ts) hand to MetricsWriter/MongoMetricsRepository. Each maps
// to one document in a native MongoDB time-series collection — `ts` is
// always that collection's timeField, everything else besides the numeric
// value becomes its metaField (see metricsRepository.ts).

export interface SignalVolumePoint {
  readonly ts: Date;
  readonly componentId: string;
  readonly severity: string;
  readonly count: number;
}

export interface WorkItemCreatedPoint {
  readonly ts: Date;
  readonly componentType: string;
  readonly severity: string;
}

export interface StateTransitionPoint {
  readonly ts: Date;
  readonly fromState: string;
  readonly toState: string;
  /** Time spent in `fromState` before this transition, in milliseconds. */
  readonly timeInStateMs: number;
}

export interface MttrPoint {
  readonly ts: Date;
  readonly componentType: string;
  readonly severity: string;
  /** Not part of the spec's stated groupBy dimensions (componentType/severity),
   *  but kept as an extra dim so the per-component health endpoint can filter
   *  this series server-side instead of pulling records into Node to average
   *  them — see MongoMetricsRepository.queryComponentHealth. */
  readonly componentId: string;
  readonly mttrMs: number;
}

export interface AlertDispatchPoint {
  readonly ts: Date;
  readonly channel: string;
  readonly outcome: "delivered" | "failed";
}

export type IntervalUnit = "second" | "minute" | "hour" | "day";

export interface BucketSpec {
  readonly unit: IntervalUnit;
  readonly binSize: number;
}

export type IncidentGroupBy = "componentType" | "severity";

export interface ThroughputBucket {
  readonly bucket: Date;
  readonly componentId: string;
  readonly severity: string;
  readonly count: number;
}

export interface GroupedCountBucket {
  readonly bucket: Date;
  readonly value: string;
  readonly count: number;
}

export interface MttrTrendBucket {
  readonly bucket: Date;
  readonly value: string;
  readonly avgMttrMs: number;
  readonly rollingAvgMttrMs: number;
  readonly sampleCount: number;
}

export interface ComponentHealthAggregate {
  readonly recentSignalCount: number;
  readonly avgMttrMs: number | null;
}

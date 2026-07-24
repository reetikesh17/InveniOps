import type { Db, Document } from "mongodb";
import type {
  AlertDispatchPoint,
  BucketSpec,
  ComponentHealthAggregate,
  GroupedCountBucket,
  IncidentGroupBy,
  MttrPoint,
  MttrTrendBucket,
  SignalVolumePoint,
  StateTransitionPoint,
  ThroughputBucket,
  WorkItemCreatedPoint,
} from "./types.js";

interface SeriesDefinition {
  readonly name: string;
  /** See docs/data-model.md for the rationale behind each window. */
  readonly retentionSeconds: number;
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

// High write-volume, short-lived-value series (raw throughput/transition/
// delivery events) get 30 days. Lower-volume, longer-value series (one row
// per work item created or closed) get 90 days for a meaningful trend line.
const SIGNAL_VOLUME: SeriesDefinition = { name: "signal_volume_metrics", retentionSeconds: THIRTY_DAYS_SECONDS };
const WORKITEM_CREATED: SeriesDefinition = { name: "workitem_created_metrics", retentionSeconds: NINETY_DAYS_SECONDS };
const STATE_TRANSITION: SeriesDefinition = { name: "state_transition_metrics", retentionSeconds: THIRTY_DAYS_SECONDS };
const MTTR: SeriesDefinition = { name: "mttr_metrics", retentionSeconds: NINETY_DAYS_SECONDS };
const ALERT_DISPATCH: SeriesDefinition = { name: "alert_dispatch_metrics", retentionSeconds: THIRTY_DAYS_SECONDS };

const ALL_SERIES: readonly SeriesDefinition[] = [SIGNAL_VOLUME, WORKITEM_CREATED, STATE_TRANSITION, MTTR, ALERT_DISPATCH];

// Rolling MTTR aggregate window, in buckets (current + this many prior) —
// see queryMttrTrend.
const ROLLING_WINDOW_BUCKETS = 4;

interface ThroughputAggDoc {
  readonly bucket: Date;
  readonly componentId: string;
  readonly severity: string;
  readonly count: number;
}

interface GroupedCountAggDoc {
  readonly bucket: Date;
  readonly value: string;
  readonly count: number;
}

interface MttrTrendAggDoc {
  readonly bucket: Date;
  readonly value: string;
  readonly avgMttrMs: number;
  readonly rollingAvgMttrMs: number;
  readonly sampleCount: number;
}

interface SumAggDoc {
  readonly total: number;
}

interface AvgAggDoc {
  readonly avg: number;
}

/**
 * Backs "Sink (Aggregations)" (docs/assignment.md section 2B) with native
 * MongoDB time-series collections — see the chat proposal this was built
 * from for the comparison against Redis TimeSeries / TimescaleDB / a
 * dedicated store. Every series is written pre-aggregated per call (the
 * caller groups points before calling in*, not one document per raw
 * signal) and bucketed further at query time via the aggregation
 * pipeline — no raw documents are ever pulled into Node and summed there.
 */
export class MongoMetricsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Idempotent, safe to call on every worker startup (mirrors
   * MongoSignalRepository.ensureIndexes()): creates each time-series
   * collection with its retention policy if it doesn't already exist.
   * createCollection itself is NOT idempotent (throws NamespaceExists on a
   * second call), hence the existence check first.
   */
  async ensureCollections(): Promise<void> {
    const existingNames = new Set(
      (await this.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
    );
    for (const series of ALL_SERIES) {
      if (existingNames.has(series.name)) {
        continue;
      }
      await this.db.createCollection(series.name, {
        timeseries: { timeField: "ts", metaField: "dims", granularity: "minutes" },
        expireAfterSeconds: series.retentionSeconds,
      });
    }
  }

  async recordSignalVolume(points: readonly SignalVolumePoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    await this.db.collection(SIGNAL_VOLUME.name).insertMany(
      points.map((p) => ({ ts: p.ts, dims: { componentId: p.componentId, severity: p.severity }, count: p.count })),
      { ordered: false },
    );
  }

  async recordWorkItemsCreated(points: readonly WorkItemCreatedPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    await this.db.collection(WORKITEM_CREATED.name).insertMany(
      points.map((p) => ({ ts: p.ts, dims: { componentType: p.componentType, severity: p.severity }, count: 1 })),
      { ordered: false },
    );
  }

  async recordStateTransitions(points: readonly StateTransitionPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    await this.db.collection(STATE_TRANSITION.name).insertMany(
      points.map((p) => ({
        ts: p.ts,
        dims: { fromState: p.fromState, toState: p.toState },
        count: 1,
        timeInStateMs: p.timeInStateMs,
      })),
      { ordered: false },
    );
  }

  async recordMttr(points: readonly MttrPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    await this.db.collection(MTTR.name).insertMany(
      points.map((p) => ({
        ts: p.ts,
        dims: { componentType: p.componentType, severity: p.severity, componentId: p.componentId },
        mttrMs: p.mttrMs,
      })),
      { ordered: false },
    );
  }

  async recordAlertDispatches(points: readonly AlertDispatchPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    await this.db.collection(ALERT_DISPATCH.name).insertMany(
      points.map((p) => ({ ts: p.ts, dims: { channel: p.channel, outcome: p.outcome }, count: 1 })),
      { ordered: false },
    );
  }

  /** Signals/sec-style throughput, bucketed by time and grouped by (componentId, severity) — GET /analytics/throughput. */
  async queryThroughput(from: Date, to: Date, interval: BucketSpec): Promise<ThroughputBucket[]> {
    const pipeline: Document[] = [
      { $match: { ts: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: "$ts", unit: interval.unit, binSize: interval.binSize } },
            componentId: "$dims.componentId",
            severity: "$dims.severity",
          },
          count: { $sum: "$count" },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: "$_id.bucket",
          componentId: "$_id.componentId",
          severity: "$_id.severity",
          count: 1,
        },
      },
      { $sort: { bucket: 1, componentId: 1, severity: 1 } },
    ];
    const docs = await this.db.collection(SIGNAL_VOLUME.name).aggregate<ThroughputAggDoc>(pipeline).toArray();
    return docs.map((doc) => ({ bucket: doc.bucket, componentId: doc.componentId, severity: doc.severity, count: doc.count }));
  }

  /** Work items created, bucketed by time and grouped by one dimension — GET /analytics/incidents. */
  async queryIncidentCounts(
    from: Date,
    to: Date,
    interval: BucketSpec,
    groupBy: IncidentGroupBy,
  ): Promise<GroupedCountBucket[]> {
    const docs = await this.db
      .collection(WORKITEM_CREATED.name)
      .aggregate<GroupedCountAggDoc>(this.groupedCountPipeline(from, to, interval, groupBy))
      .toArray();
    return docs.map((doc) => ({ bucket: doc.bucket, value: doc.value, count: doc.count }));
  }

  private groupedCountPipeline(from: Date, to: Date, interval: BucketSpec, groupBy: IncidentGroupBy): Document[] {
    return [
      { $match: { ts: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: "$ts", unit: interval.unit, binSize: interval.binSize } },
            value: `$dims.${groupBy}`,
          },
          count: { $sum: "$count" },
        },
      },
      { $project: { _id: 0, bucket: "$_id.bucket", value: "$_id.value", count: 1 } },
      { $sort: { bucket: 1, value: 1 } },
    ];
  }

  /**
   * MTTR trend: per-bucket average plus a trailing rolling average over
   * the last ROLLING_WINDOW_BUCKETS+1 buckets, computed server-side via
   * $setWindowFields (partitioned by the groupBy dimension, sorted by
   * bucket) — not fetched raw and averaged in Node. GET /analytics/mttr.
   */
  async queryMttrTrend(
    from: Date,
    to: Date,
    interval: BucketSpec,
    groupBy: IncidentGroupBy,
  ): Promise<MttrTrendBucket[]> {
    const pipeline: Document[] = [
      { $match: { ts: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: "$ts", unit: interval.unit, binSize: interval.binSize } },
            value: `$dims.${groupBy}`,
          },
          avgMttrMs: { $avg: "$mttrMs" },
          sampleCount: { $sum: 1 },
        },
      },
      { $sort: { "_id.value": 1, "_id.bucket": 1 } },
      {
        $setWindowFields: {
          partitionBy: "$_id.value",
          sortBy: { "_id.bucket": 1 },
          output: {
            rollingAvgMttrMs: { $avg: "$avgMttrMs", window: { documents: [-ROLLING_WINDOW_BUCKETS, 0] } },
          },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: "$_id.bucket",
          value: "$_id.value",
          avgMttrMs: 1,
          rollingAvgMttrMs: 1,
          sampleCount: 1,
        },
      },
      { $sort: { value: 1, bucket: 1 } },
    ];
    const docs = await this.db.collection(MTTR.name).aggregate<MttrTrendAggDoc>(pipeline).toArray();
    return docs.map((doc) => ({
      bucket: doc.bucket,
      value: doc.value,
      avgMttrMs: doc.avgMttrMs,
      rollingAvgMttrMs: doc.rollingAvgMttrMs,
      sampleCount: doc.sampleCount,
    }));
  }

  /** Recent signal volume + all-time average MTTR for one component, both aggregated server-side — feeds GET /analytics/components/:id. */
  async queryComponentHealth(componentId: string, recentSince: Date): Promise<ComponentHealthAggregate> {
    const [volumeDocs, mttrDocs] = await Promise.all([
      this.db
        .collection(SIGNAL_VOLUME.name)
        .aggregate<SumAggDoc>([
          { $match: { "dims.componentId": componentId, ts: { $gte: recentSince } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ])
        .toArray(),
      this.db
        .collection(MTTR.name)
        .aggregate<AvgAggDoc>([
          { $match: { "dims.componentId": componentId } },
          { $group: { _id: null, avg: { $avg: "$mttrMs" } } },
        ])
        .toArray(),
    ]);

    return {
      recentSignalCount: volumeDocs[0]?.total ?? 0,
      avgMttrMs: mttrDocs[0]?.avg ?? null,
    };
  }
}

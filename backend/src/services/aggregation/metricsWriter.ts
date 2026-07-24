import type { Logger } from "pino";
import type {
  AlertDispatchPoint,
  MttrPoint,
  SignalVolumePoint,
  StateTransitionPoint,
  WorkItemCreatedPoint,
} from "../../repositories/metrics/index.js";

// Narrow, structural interface — MongoMetricsRepository satisfies it
// without an adapter, tests can substitute a fake with zero real Mongo.
export interface MetricsRepositoryWriter {
  recordSignalVolume(points: readonly SignalVolumePoint[]): Promise<void>;
  recordWorkItemsCreated(points: readonly WorkItemCreatedPoint[]): Promise<void>;
  recordStateTransitions(points: readonly StateTransitionPoint[]): Promise<void>;
  recordMttr(points: readonly MttrPoint[]): Promise<void>;
  recordAlertDispatches(points: readonly AlertDispatchPoint[]): Promise<void>;
}

export interface MetricsWriterOptions {
  readonly logger?: Pick<Logger, "warn" | "error">;
}

/**
 * The aggregation write path's single rule, enforced here rather than left
 * to every call site to remember: a metrics write is best-effort. Every
 * method below always resolves — a failure is logged and the point is
 * dropped, never retried (an indefinite retry loop is exactly what could
 * turn a metrics-store hiccup into back-pressure on signal persistence,
 * which this must never cause or block).
 */
export class MetricsWriter {
  constructor(
    private readonly repo: MetricsRepositoryWriter,
    private readonly options: MetricsWriterOptions = {},
  ) {}

  async recordSignalVolume(points: readonly SignalVolumePoint[]): Promise<void> {
    await this.safe(() => this.repo.recordSignalVolume(points), "signal_volume");
  }

  async recordWorkItemsCreated(points: readonly WorkItemCreatedPoint[]): Promise<void> {
    await this.safe(() => this.repo.recordWorkItemsCreated(points), "workitem_created");
  }

  async recordStateTransitions(points: readonly StateTransitionPoint[]): Promise<void> {
    await this.safe(() => this.repo.recordStateTransitions(points), "state_transition");
  }

  async recordMttr(points: readonly MttrPoint[]): Promise<void> {
    await this.safe(() => this.repo.recordMttr(points), "mttr");
  }

  async recordAlertDispatches(points: readonly AlertDispatchPoint[]): Promise<void> {
    await this.safe(() => this.repo.recordAlertDispatches(points), "alert_dispatch");
  }

  private async safe(write: () => Promise<void>, series: string): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.options.logger?.error({ error, series }, "metrics write failed — dropped, not retried");
    }
  }
}

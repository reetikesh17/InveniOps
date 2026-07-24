import { describe, expect, it, vi } from "vitest";
import { MetricsWriter, type MetricsRepositoryWriter } from "../../../../src/services/aggregation/metricsWriter.js";
import type {
  AlertDispatchPoint,
  MttrPoint,
  SignalVolumePoint,
  StateTransitionPoint,
  WorkItemCreatedPoint,
} from "../../../../src/repositories/metrics/index.js";

// Returns both the repo (to hand to MetricsWriter) and each mock function
// as a standalone binding — asserting on `repo.someMethod` directly trips
// eslint's unbound-method rule, so tests below assert on these instead.
function workingRepo(): {
  readonly repo: MetricsRepositoryWriter;
  readonly recordSignalVolume: ReturnType<typeof vi.fn<(points: readonly SignalVolumePoint[]) => Promise<void>>>;
  readonly recordWorkItemsCreated: ReturnType<typeof vi.fn<(points: readonly WorkItemCreatedPoint[]) => Promise<void>>>;
  readonly recordStateTransitions: ReturnType<typeof vi.fn<(points: readonly StateTransitionPoint[]) => Promise<void>>>;
  readonly recordMttr: ReturnType<typeof vi.fn<(points: readonly MttrPoint[]) => Promise<void>>>;
  readonly recordAlertDispatches: ReturnType<typeof vi.fn<(points: readonly AlertDispatchPoint[]) => Promise<void>>>;
} {
  const recordSignalVolume = vi.fn<(points: readonly SignalVolumePoint[]) => Promise<void>>().mockResolvedValue(undefined);
  const recordWorkItemsCreated = vi
    .fn<(points: readonly WorkItemCreatedPoint[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const recordStateTransitions = vi
    .fn<(points: readonly StateTransitionPoint[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const recordMttr = vi.fn<(points: readonly MttrPoint[]) => Promise<void>>().mockResolvedValue(undefined);
  const recordAlertDispatches = vi
    .fn<(points: readonly AlertDispatchPoint[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const repo: MetricsRepositoryWriter = {
    recordSignalVolume,
    recordWorkItemsCreated,
    recordStateTransitions,
    recordMttr,
    recordAlertDispatches,
  };
  return { repo, recordSignalVolume, recordWorkItemsCreated, recordStateTransitions, recordMttr, recordAlertDispatches };
}

describe("MetricsWriter", () => {
  it("delegates every method to the underlying repository when writes succeed", async () => {
    const { repo, recordSignalVolume, recordWorkItemsCreated, recordStateTransitions, recordMttr, recordAlertDispatches } =
      workingRepo();
    const writer = new MetricsWriter(repo);

    await writer.recordSignalVolume([{ ts: new Date(), componentId: "c", severity: "P1", count: 1 }]);
    await writer.recordWorkItemsCreated([{ ts: new Date(), componentType: "CACHE", severity: "P1" }]);
    await writer.recordStateTransitions([{ ts: new Date(), fromState: "OPEN", toState: "INVESTIGATING", timeInStateMs: 10 }]);
    await writer.recordMttr([{ ts: new Date(), componentType: "CACHE", severity: "P1", componentId: "c", mttrMs: 1000 }]);
    await writer.recordAlertDispatches([{ ts: new Date(), channel: "slack", outcome: "delivered" }]);

    expect(recordSignalVolume).toHaveBeenCalledTimes(1);
    expect(recordWorkItemsCreated).toHaveBeenCalledTimes(1);
    expect(recordStateTransitions).toHaveBeenCalledTimes(1);
    expect(recordMttr).toHaveBeenCalledTimes(1);
    expect(recordAlertDispatches).toHaveBeenCalledTimes(1);
  });

  it("recordSignalVolume: a repository failure is logged and swallowed, never rejected, and not retried", async () => {
    const { repo, recordSignalVolume } = workingRepo();
    recordSignalVolume.mockRejectedValue(new Error("mongo is down"));
    const errorLog = vi.fn();
    const writer = new MetricsWriter(repo, { logger: { warn: vi.fn(), error: errorLog } });

    await expect(writer.recordSignalVolume([{ ts: new Date(), componentId: "c", severity: "P1", count: 1 }])).resolves.toBeUndefined();

    expect(recordSignalVolume).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("recordWorkItemsCreated: a repository failure is logged and swallowed", async () => {
    const { repo, recordWorkItemsCreated } = workingRepo();
    recordWorkItemsCreated.mockRejectedValue(new Error("mongo is down"));
    const errorLog = vi.fn();
    const writer = new MetricsWriter(repo, { logger: { warn: vi.fn(), error: errorLog } });

    await expect(writer.recordWorkItemsCreated([{ ts: new Date(), componentType: "CACHE", severity: "P1" }])).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("recordStateTransitions: a repository failure is logged and swallowed", async () => {
    const { repo, recordStateTransitions } = workingRepo();
    recordStateTransitions.mockRejectedValue(new Error("mongo is down"));
    const errorLog = vi.fn();
    const writer = new MetricsWriter(repo, { logger: { warn: vi.fn(), error: errorLog } });

    await expect(
      writer.recordStateTransitions([{ ts: new Date(), fromState: "OPEN", toState: "INVESTIGATING", timeInStateMs: 10 }]),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("recordMttr: a repository failure is logged and swallowed", async () => {
    const { repo, recordMttr } = workingRepo();
    recordMttr.mockRejectedValue(new Error("mongo is down"));
    const errorLog = vi.fn();
    const writer = new MetricsWriter(repo, { logger: { warn: vi.fn(), error: errorLog } });

    await expect(
      writer.recordMttr([{ ts: new Date(), componentType: "CACHE", severity: "P1", componentId: "c", mttrMs: 1000 }]),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("recordAlertDispatches: a repository failure is logged and swallowed", async () => {
    const { repo, recordAlertDispatches } = workingRepo();
    recordAlertDispatches.mockRejectedValue(new Error("mongo is down"));
    const errorLog = vi.fn();
    const writer = new MetricsWriter(repo, { logger: { warn: vi.fn(), error: errorLog } });

    await expect(
      writer.recordAlertDispatches([{ ts: new Date(), channel: "slack", outcome: "delivered" }]),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

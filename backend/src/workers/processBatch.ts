import type { WorkItem } from "@prisma/client";
import type { IngestionSignal } from "../services/ingestion/buffer.js";
import { signalToDocument, type DebounceResult } from "../services/ingestion/debouncer.js";
import type { InsertManyIdempotentResult, SignalDocument } from "../repositories/mongo/signalRepository.js";
import type { AlertEventType } from "../services/alerting/index.js";

// Narrow, structural interfaces — the real SignalDebouncer /
// MongoSignalRepository / PostgresWorkItemRepository / DashboardCacheRepository
// all satisfy these without an adapter, but tests can substitute fakes for
// all four without touching Postgres/Mongo/Redis, same pattern as
// debouncer.ts's own WorkItemStore/SignalStore.
export interface BatchDebouncer {
  resolveBatch(signals: readonly IngestionSignal[]): Promise<readonly DebounceResult[]>;
}

export interface BatchSignalStore {
  insertManyIdempotent(signals: readonly SignalDocument[]): Promise<InsertManyIdempotentResult>;
}

export interface BatchWorkItemStore {
  incrementSignalCount(workItemId: string, by: number): Promise<WorkItem>;
}

export interface BatchCache {
  upsertActiveIncident(workItem: WorkItem): Promise<unknown>;
}

/** Never throws — see src/services/alerting/dispatcher.ts. Optional so existing tests/callers that don't care about alerting are unaffected. */
export interface BatchAlertDispatcher {
  dispatch(workItem: WorkItem, eventType: AlertEventType): Promise<void>;
}

export interface ProcessBatchDeps {
  readonly debouncer: BatchDebouncer;
  readonly signalStore: BatchSignalStore;
  readonly workItemStore: BatchWorkItemStore;
  readonly cache: BatchCache;
  readonly alertDispatcher?: BatchAlertDispatcher;
}

export interface ProcessBatchResult {
  readonly totalSignals: number;
  readonly newlyPersisted: number;
  readonly workItemsTouched: number;
}

/**
 * The worker's per-job pipeline: resolve (debounce) -> bulk-persist to
 * Mongo -> grouped Postgres count updates -> cache refresh.
 *
 * Idempotent under BullMQ retry of the same job:
 *  - resolveBatch() only makes Redis/Postgres *decisions*, no writes, so
 *    redoing it is harmless.
 *  - insertManyIdempotent() skips signals already durably persisted by a
 *    prior attempt (see MongoSignalRepository) — the returned
 *    insertedSignalIds is the *only* thing this function trusts to decide
 *    "does this count as new."
 *  - Postgres increments are grouped and computed purely from
 *    insertedSignalIds, never from resolveBatch's `created` flag (which
 *    can't reliably tell "this signal created the work item" apart from
 *    "this signal just found the work item another attempt already
 *    created" once a job crosses a retry boundary — see debouncer.ts's
 *    toCreateInput comment for why signalCount starts at 0, not 1).
 *
 * Alert dispatch (step 5, if alertDispatcher is provided) fires exactly
 * once per work item *creation*, not per signal — debouncing already
 * collapsed the burst into one work item, and `created: true` from
 * resolveBatch is reliable for "a createWorkItem call happened during
 * *this* invocation" (unlike its use for signal counting above, this
 * doesn't need to survive a retry boundary: once a work item exists, every
 * later resolution — this attempt or a retry — sees it as existing and
 * returns created: false, so created: true can only ever appear once
 * across a work item's lifetime). The dispatcher's own Redis claim (see
 * services/alerting/suppression.ts) is what actually guarantees no
 * double-send, not this flag alone.
 */
export async function processBatch(
  signals: readonly IngestionSignal[],
  deps: ProcessBatchDeps,
): Promise<ProcessBatchResult> {
  if (signals.length === 0) {
    return { totalSignals: 0, newlyPersisted: 0, workItemsTouched: 0 };
  }

  const resolutions = await deps.debouncer.resolveBatch(signals);

  const documents = signals.map((signal, index) => signalToDocument(signal, resolutions[index]!.workItemId));
  const { insertedSignalIds } = await deps.signalStore.insertManyIdempotent(documents);
  const insertedSet = new Set(insertedSignalIds);

  const incrementsByWorkItemId = new Map<string, number>();
  signals.forEach((signal, index) => {
    if (!insertedSet.has(signal.signalId)) {
      return;
    }
    const { workItemId } = resolutions[index]!;
    incrementsByWorkItemId.set(workItemId, (incrementsByWorkItemId.get(workItemId) ?? 0) + 1);
  });

  const updatedWorkItems = await Promise.all(
    [...incrementsByWorkItemId.entries()].map(([workItemId, by]) =>
      deps.workItemStore.incrementSignalCount(workItemId, by),
    ),
  );

  await Promise.all(updatedWorkItems.map((workItem) => deps.cache.upsertActiveIncident(workItem)));

  const { alertDispatcher } = deps;
  if (alertDispatcher) {
    const createdWorkItemIds = new Set(resolutions.filter((result) => result.created).map((result) => result.workItemId));
    const createdWorkItems = updatedWorkItems.filter((workItem) => createdWorkItemIds.has(workItem.id));
    await Promise.all(createdWorkItems.map((workItem) => alertDispatcher.dispatch(workItem, "created")));
  }

  return {
    totalSignals: signals.length,
    newlyPersisted: insertedSet.size,
    workItemsTouched: updatedWorkItems.length,
  };
}

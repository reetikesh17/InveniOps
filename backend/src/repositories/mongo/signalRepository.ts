import { MongoBulkWriteError, type Collection, type Db, type WriteError } from "mongodb";

const COLLECTION_NAME = "signals";
const DUPLICATE_KEY_ERROR_CODE = 11000;

// Mirrors docs/data-model.md's design: signalId assigned at ingestion
// (before persistence, so the ingestion API can ack without waiting on
// this write), workItemId null until the debouncer assigns one.
export interface SignalDocument {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: string;
  readonly severity: string;
  readonly rawPayload: unknown;
  /** When the signal source says the underlying event happened — client-reported, may lag or skew. */
  readonly occurredAt: Date;
  /** When the ingestion API actually received it — server-controlled. */
  readonly receivedAt: Date;
  readonly workItemId: string | null;
}

export interface Pagination {
  readonly limit: number;
  readonly offset: number;
}

export interface InsertManyIdempotentResult {
  /** signalIds that were genuinely new this call — the only ones a caller should count. */
  readonly insertedSignalIds: readonly string[];
}

export class MongoSignalRepository {
  constructor(private readonly db: Db) {}

  /**
   * One-time provisioning, not called on the insert hot path: a unique
   * index on signalId (the idempotency backstop insertManyIdempotent
   * relies on) and a plain index on workItemId (countByWorkItemId /
   * findByWorkItemId are on the worker's per-batch hot path now, via the
   * cache-refresh step — see src/workers/processBatch.ts). createIndex is
   * itself idempotent, safe to call every time a worker process starts —
   * deliberately no explicit `name` here, so it resolves to the same
   * auto-generated name MongoDB would give it anywhere else this exact key
   * pattern gets created (an explicit name that happened to differ would
   * make Mongo treat it as a conflicting *second* index instead).
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ signalId: 1 }, { unique: true });
    await this.collection.createIndex({ workItemId: 1 });
  }

  /**
   * Workers write in batches, not one at a time. Uses ordered: false so
   * one malformed document in a batch doesn't sink the rest of it — as
   * many valid signals as possible still get persisted.
   */
  async insertMany(signals: readonly SignalDocument[]): Promise<void> {
    if (signals.length === 0) {
      return;
    }
    await this.collection.insertMany([...signals], { ordered: false });
  }

  /**
   * Like insertMany, but safe to call twice with overlapping signals — the
   * BullMQ worker's natural retry-on-failure path (src/workers/signalWorker.ts)
   * can re-deliver a batch that partially succeeded before. Signals already
   * present (by signalId) are skipped up front; the unique index from
   * ensureIndexes is the backstop against the small race between that
   * pre-check and the insert itself (two concurrent attempts inserting the
   * same signalId) — a resulting duplicate-key error is swallowed, not
   * treated as failure, since ordered:false means every non-conflicting
   * document in the call still landed.
   */
  async insertManyIdempotent(signals: readonly SignalDocument[]): Promise<InsertManyIdempotentResult> {
    if (signals.length === 0) {
      return { insertedSignalIds: [] };
    }

    const signalIds = signals.map((signal) => signal.signalId);
    const existing = await this.collection
      .find({ signalId: { $in: signalIds } }, { projection: { signalId: 1, _id: 0 } })
      .toArray();
    const existingIds = new Set(existing.map((doc) => doc.signalId));
    const newDocs = signals.filter((signal) => !existingIds.has(signal.signalId));

    if (newDocs.length === 0) {
      return { insertedSignalIds: [] };
    }

    try {
      await this.collection.insertMany([...newDocs], { ordered: false });
      return { insertedSignalIds: newDocs.map((signal) => signal.signalId) };
    } catch (error) {
      if (error instanceof MongoBulkWriteError && isAllDuplicateKeyErrors(error)) {
        const failedIndexes = new Set(writeErrorIndexes(error));
        const insertedSignalIds = newDocs
          .filter((_, index) => !failedIndexes.has(index))
          .map((signal) => signal.signalId);
        return { insertedSignalIds };
      }
      throw error;
    }
  }

  async findByWorkItemId(workItemId: string, pagination: Pagination): Promise<SignalDocument[]> {
    return this.collection
      .find({ workItemId })
      .sort({ receivedAt: 1 })
      .skip(pagination.offset)
      .limit(pagination.limit)
      .toArray();
  }

  async findByComponentInWindow(componentId: string, from: Date, to: Date): Promise<SignalDocument[]> {
    return this.collection
      .find({ componentId, receivedAt: { $gte: from, $lte: to } })
      .sort({ receivedAt: 1 })
      .toArray();
  }

  async countByWorkItemId(workItemId: string): Promise<number> {
    return this.collection.countDocuments({ workItemId });
  }

  private get collection(): Collection<SignalDocument> {
    return this.db.collection<SignalDocument>(COLLECTION_NAME);
  }
}

function asWriteErrorArray(writeErrors: MongoBulkWriteError["writeErrors"]): readonly WriteError[] {
  // Array.isArray's built-in type guard narrows to `any[]`, not `T[]` — an
  // explicit cast here is deliberate, not a lint-suppression shortcut.
  if (Array.isArray(writeErrors)) {
    return writeErrors as readonly WriteError[];
  }
  return [writeErrors as WriteError];
}

function writeErrorIndexes(error: MongoBulkWriteError): readonly number[] {
  return asWriteErrorArray(error.writeErrors).map((writeError) => writeError.index);
}

function isAllDuplicateKeyErrors(error: MongoBulkWriteError): boolean {
  const writeErrors = asWriteErrorArray(error.writeErrors);
  return writeErrors.length > 0 && writeErrors.every((writeError) => writeError.code === DUPLICATE_KEY_ERROR_CODE);
}

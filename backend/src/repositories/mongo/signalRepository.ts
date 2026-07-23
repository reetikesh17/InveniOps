import type { Collection, Db } from "mongodb";

const COLLECTION_NAME = "signals";

// Mirrors docs/data-model.md's design: signalId assigned at ingestion
// (before persistence, so the ingestion API can ack without waiting on
// this write), workItemId null until the debouncer assigns one.
export interface SignalDocument {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: string;
  readonly severity: string;
  readonly rawPayload: unknown;
  readonly receivedAt: Date;
  readonly workItemId: string | null;
}

export interface Pagination {
  readonly limit: number;
  readonly offset: number;
}

export class MongoSignalRepository {
  constructor(private readonly db: Db) {}

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

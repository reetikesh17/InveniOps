import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { WorkItem } from "@prisma/client";
import type { CreateWorkItemInput } from "../../repositories/postgres/workItemRepository.js";
import { isUniqueConstraintViolation } from "../../repositories/postgres/prismaErrors.js";
import type { SignalDocument } from "../../repositories/mongo/signalRepository.js";
import type { IngestionSignal } from "./buffer.js";

// Name of the partial unique index from
// prisma/migrations/20260723151018_add_active_component_unique_index —
// "at most one non-CLOSED work item per component_id". That constraint is
// the actual correctness guarantee this class relies on; everything else
// here (the Redis session cache, the creation lock) exists purely to keep
// the common case off the database, not to provide correctness on its own.
const ACTIVE_COMPONENT_INDEX_NAME = "idx_work_items_active_component_id";

/** The subset of PostgresWorkItemRepository the debouncer needs — real repo satisfies this structurally. */
export interface WorkItemStore {
  createWorkItem(input: CreateWorkItemInput): Promise<WorkItem>;
  findActiveByComponentId(componentId: string): Promise<WorkItem[]>;
  incrementSignalCount(workItemId: string, by: number): Promise<WorkItem>;
}

/** The subset of MongoSignalRepository the debouncer needs. */
export interface SignalStore {
  insertMany(signals: readonly SignalDocument[]): Promise<void>;
}

export interface DebounceResult {
  readonly workItemId: string;
  readonly created: boolean;
}

export interface SignalDebouncerOptions {
  /** How long a Redis-cached session is trusted before re-verifying against Postgres. */
  readonly windowSeconds: number;
  /** How many signals a session may fast-path before re-verifying against Postgres. */
  readonly threshold: number;
  readonly lockTtlMs: number;
  /** How long to wait for another worker's in-flight resolution before resolving independently. */
  readonly lockWaitTimeoutMs: number;
  readonly lockPollIntervalMs: number;
  /** Defaults to recognizing the active-component partial unique index conflict. */
  readonly isConflictError?: (error: unknown) => boolean;
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
}

interface Session {
  readonly workItemId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Collapses bursts of signals for the same component into one work item.
 * See docs for the full design; in short:
 *
 * - Correctness comes from a Postgres partial unique index
 *   (`idx_work_items_active_component_id`, one non-CLOSED work item per
 *   component) — never from Redis. Redis is purely a fast path.
 * - A Redis session hash per component (`{workItemId, count, startedAtMs}`,
 *   capped by both `threshold` and `windowSeconds`) lets signals 2..N of a
 *   burst skip Postgres entirely and just link.
 * - On a cache miss, a short-lived Redis lock reduces (but does not
 *   guarantee) how many concurrent callers hit Postgres at once; losing
 *   the race for the lock just means waiting briefly for the winner's
 *   session to appear, then falling back to resolving independently if it
 *   doesn't — still correct either way.
 */
export class SignalDebouncer {
  constructor(
    private readonly workItemStore: WorkItemStore,
    private readonly signalStore: SignalStore,
    private readonly redis: Redis,
    private readonly options: SignalDebouncerOptions,
  ) {}

  async processSignal(signal: IngestionSignal): Promise<DebounceResult> {
    const cached = await this.readValidSession(signal.componentId);
    if (cached) {
      await this.linkSignal(cached.workItemId, signal);
      await this.bumpSessionCount(signal.componentId);
      return { workItemId: cached.workItemId, created: false };
    }
    return this.resolveViaLock(signal);
  }

  private async resolveViaLock(signal: IngestionSignal): Promise<DebounceResult> {
    const { componentId } = signal;
    const token = randomUUID();
    const acquired = await this.redis.set(this.lockKey(componentId), token, "PX", this.options.lockTtlMs, "NX");

    if (acquired === "OK") {
      try {
        return await this.resolveFromStore(signal);
      } finally {
        // Best-effort, not a compare-and-delete: if this lock already
        // expired and someone else re-acquired it, an unconditional DEL
        // here just costs a little extra contention for that caller, not
        // correctness — the unique index is what actually matters.
        await this.redis.del(this.lockKey(componentId));
      }
    }

    const waited = await this.pollForSession(componentId);
    if (waited) {
      await this.linkSignal(waited.workItemId, signal);
      await this.bumpSessionCount(componentId);
      return { workItemId: waited.workItemId, created: false };
    }

    // Gave up waiting for the lock holder — resolve independently. Still
    // correct: the DB constraint, not the lock, is what prevents a
    // duplicate work item.
    return this.resolveFromStore(signal);
  }

  private async resolveFromStore(signal: IngestionSignal): Promise<DebounceResult> {
    const { componentId } = signal;
    const active = await this.workItemStore.findActiveByComponentId(componentId);
    const existing = active[0];

    if (existing) {
      await this.seedSession(componentId, existing.id);
      await this.linkSignal(existing.id, signal);
      return { workItemId: existing.id, created: false };
    }

    try {
      const created = await this.workItemStore.createWorkItem(this.toCreateInput(signal));
      await this.seedSession(componentId, created.id);
      await this.signalStore.insertMany([this.toSignalDocument(signal, created.id)]);
      return { workItemId: created.id, created: true };
    } catch (error) {
      if (!this.isConflictError(error)) {
        throw error;
      }

      // Another worker won the race and created the work item first —
      // expected, correct-path contention. Link to whatever it created.
      const winner = (await this.workItemStore.findActiveByComponentId(componentId))[0];
      if (!winner) {
        throw new Error(
          `SignalDebouncer: create conflicted for component "${componentId}" but no active work item was found afterward`,
        );
      }
      await this.seedSession(componentId, winner.id);
      await this.linkSignal(winner.id, signal);
      return { workItemId: winner.id, created: false };
    }
  }

  private async linkSignal(workItemId: string, signal: IngestionSignal): Promise<void> {
    await this.signalStore.insertMany([this.toSignalDocument(signal, workItemId)]);
    await this.workItemStore.incrementSignalCount(workItemId, 1);
  }

  private async pollForSession(componentId: string): Promise<Session | null> {
    const deadline = Date.now() + this.options.lockWaitTimeoutMs;
    while (Date.now() < deadline) {
      const session = await this.readValidSession(componentId);
      if (session) {
        return session;
      }
      await sleep(this.options.lockPollIntervalMs);
    }
    return null;
  }

  private async readValidSession(componentId: string): Promise<Session | null> {
    const raw = await this.redis.hgetall(this.sessionKey(componentId));
    const workItemId = raw["workItemId"];
    if (!workItemId) {
      return null;
    }

    const count = Number(raw["count"] ?? "0");
    const startedAtMs = Number(raw["startedAtMs"] ?? "0");

    if (count >= this.options.threshold) {
      return null;
    }
    if (Date.now() - startedAtMs >= this.options.windowSeconds * 1000) {
      return null;
    }

    return { workItemId };
  }

  private async seedSession(componentId: string, workItemId: string): Promise<void> {
    const key = this.sessionKey(componentId);
    await this.redis.hset(key, { workItemId, count: "0", startedAtMs: String(Date.now()) });
    await this.redis.expire(key, this.options.windowSeconds);
  }

  private async bumpSessionCount(componentId: string): Promise<void> {
    // Best-effort and approximate under real concurrency (a plain
    // HINCRBY, not a Lua-scripted read-modify-write) — that's fine here,
    // unlike the rate limiter's token bucket. This count only decides when
    // to stop trusting the cache and re-verify against Postgres; it is
    // never the thing enforcing "only one work item."
    await this.redis.hincrby(this.sessionKey(componentId), "count", 1);
  }

  private toCreateInput(signal: IngestionSignal): CreateWorkItemInput {
    return {
      componentId: signal.componentId,
      componentType: signal.componentType,
      severity: signal.severity,
      title: `${signal.componentType} incident on ${signal.componentId}`,
      // Server-controlled, not the client-reported occurredAt — MTTR and
      // RCA validation both anchor on this timestamp, and a client-supplied
      // one is trusted input, not a safe basis for it.
      firstSignalAt: signal.receivedAt,
    };
  }

  private toSignalDocument(signal: IngestionSignal, workItemId: string | null): SignalDocument {
    return {
      signalId: signal.signalId,
      componentId: signal.componentId,
      componentType: signal.componentType,
      severity: signal.severity,
      rawPayload: signal.rawPayload,
      occurredAt: signal.occurredAt,
      receivedAt: signal.receivedAt,
      workItemId,
    };
  }

  private isConflictError(error: unknown): boolean {
    if (this.options.isConflictError) {
      return this.options.isConflictError(error);
    }
    return isUniqueConstraintViolation(error, ACTIVE_COMPONENT_INDEX_NAME);
  }

  private sessionKey(componentId: string): string {
    return `debounce:session:${componentId}`;
  }

  private lockKey(componentId: string): string {
    return `debounce:lock:${componentId}`;
  }
}

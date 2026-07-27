import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { ComponentType, Prisma, Severity, WorkItemStatus, type WorkItem } from "@prisma/client";
import { SignalDebouncer, type SignalDebouncerOptions, type WorkItemStore, type SignalStore } from "../../../../src/services/ingestion/debouncer.js";
import type { CreateWorkItemInput } from "../../../../src/repositories/postgres/workItemRepository.js";
import type { SignalDocument } from "../../../../src/repositories/mongo/signalRepository.js";
import type { IngestionSignal } from "../../../../src/services/ingestion/buffer.js";

// The same real classification logic the debouncer uses by default (see
// isConflictError in debouncer.ts) — constructing an actual
// PrismaClientKnownRequestError rather than a plain Error keeps this test
// honest about what a real create-race failure looks like.
const ACTIVE_COMPONENT_INDEX_NAME = "idx_work_items_active_component_id";
function conflictError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique constraint failed", {
    code: "P2002",
    clientVersion: "5.16.1",
    meta: { target: ACTIVE_COMPONENT_INDEX_NAME },
  });
}

const FIRST_SIGNAL_AT = new Date("2026-01-01T00:00:00.000Z");

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    componentId: "CACHE_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    state: WorkItemStatus.OPEN,
    title: "test incident",
    firstSignalAt: FIRST_SIGNAL_AT,
    resolvedAt: null,
    closedAt: null,
    signalCount: 1,
    createdAt: FIRST_SIGNAL_AT,
    updatedAt: FIRST_SIGNAL_AT,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<IngestionSignal> = {}): IngestionSignal {
  return {
    signalId: "sig-1",
    componentId: "CACHE_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    rawPayload: { message: "connection refused" },
    occurredAt: FIRST_SIGNAL_AT,
    receivedAt: FIRST_SIGNAL_AT,
    correlationId: "req-1",
    ...overrides,
  };
}

/** Narrow, in-memory stand-in for ioredis — implements exactly the handful of commands SignalDebouncer calls. */
class FakeRedis {
  private readonly hashes = new Map<string, Record<string, string>>();
  private readonly locks = new Set<string>();

  set(key: string): Promise<"OK" | null> {
    // Every call site in debouncer.ts passes NX — this fake only needs to
    // model that mode, not ioredis's full overload surface, so it ignores
    // the value/PX/NX arguments a real caller would also pass.
    if (this.locks.has(key)) {
      return Promise.resolve(null);
    }
    this.locks.add(key);
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    const had = this.locks.delete(key);
    return Promise.resolve(had ? 1 : 0);
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return Promise.resolve({ ...(this.hashes.get(key) ?? {}) });
  }

  hset(key: string, fields: Record<string, string>): Promise<number> {
    const existing = this.hashes.get(key) ?? {};
    this.hashes.set(key, { ...existing, ...fields });
    return Promise.resolve(Object.keys(fields).length);
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }

  hincrby(key: string, field: string, amount: number): Promise<number> {
    const existing = this.hashes.get(key) ?? {};
    const next = Number(existing[field] ?? "0") + amount;
    existing[field] = String(next);
    this.hashes.set(key, existing);
    return Promise.resolve(next);
  }

  /** Test-only helper: pre-seed a session hash directly, bypassing seedSession's Date.now() timing. */
  seedSessionHash(componentId: string, fields: Record<string, string>): void {
    this.hashes.set(`debounce:session:${componentId}`, fields);
  }

  /** Test-only helper: simulate another worker already holding the creation lock. */
  holdLock(componentId: string): void {
    this.locks.add(`debounce:lock:${componentId}`);
  }

  /** Test-only helper: inspect lock state directly, rather than inferring it from a second call's timing/behaviour. */
  isLocked(componentId: string): boolean {
    return this.locks.has(`debounce:lock:${componentId}`);
  }
}

interface FakeWorkItemStore extends WorkItemStore {
  readonly createCalls: CreateWorkItemInput[];
  readonly incrementCalls: Array<{ workItemId: string; by: number }>;
  readonly findActiveCalls: string[];
}

function fakeWorkItemStore(
  overrides: {
    findActiveByComponentId?: (componentId: string) => Promise<WorkItem[]>;
    createWorkItem?: (input: CreateWorkItemInput) => Promise<WorkItem>;
  } = {},
): FakeWorkItemStore {
  const createCalls: CreateWorkItemInput[] = [];
  const incrementCalls: Array<{ workItemId: string; by: number }> = [];
  const findActiveCalls: string[] = [];
  return {
    createCalls,
    incrementCalls,
    findActiveCalls,
    findActiveByComponentId(componentId: string): Promise<WorkItem[]> {
      findActiveCalls.push(componentId);
      return overrides.findActiveByComponentId ? overrides.findActiveByComponentId(componentId) : Promise.resolve([]);
    },
    createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
      createCalls.push(input);
      return overrides.createWorkItem ? overrides.createWorkItem(input) : Promise.resolve(makeWorkItem());
    },
    incrementSignalCount(workItemId: string, by: number): Promise<WorkItem> {
      incrementCalls.push({ workItemId, by });
      return Promise.resolve(makeWorkItem({ id: workItemId }));
    },
  };
}

function fakeSignalStore(): SignalStore & { insertedBatches: SignalDocument[][] } {
  const insertedBatches: SignalDocument[][] = [];
  return {
    insertedBatches,
    insertMany(signals: readonly SignalDocument[]): Promise<void> {
      insertedBatches.push([...signals]);
      return Promise.resolve();
    },
  };
}

/** Returns a findActiveByComponentId override that answers `results[call number]`, clamped to the last entry once exhausted. */
function sequencedFindActive(...results: WorkItem[][]): (componentId: string) => Promise<WorkItem[]> {
  let call = 0;
  return () => {
    const result = results[Math.min(call, results.length - 1)] ?? [];
    call += 1;
    return Promise.resolve(result);
  };
}

const BASE_OPTIONS: SignalDebouncerOptions = {
  windowSeconds: 10,
  threshold: 100,
  lockTtlMs: 2000,
  lockWaitTimeoutMs: 50,
  lockPollIntervalMs: 5,
};

describe("SignalDebouncer", () => {
  describe("resolve — cache miss, no active work item", () => {
    it("creates a new work item and seeds a session", async () => {
      const workItemStore = fakeWorkItemStore();
      const signalStore = fakeSignalStore();
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, signalStore, redis as unknown as Redis, BASE_OPTIONS);

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-1", created: true });
      expect(workItemStore.createCalls).toHaveLength(1);
      expect(signalStore.insertedBatches).toHaveLength(1);
      expect(workItemStore.incrementCalls).toEqual([{ workItemId: "wi-1", by: 1 }]);

      const session = await redis.hgetall("debounce:session:CACHE_01");
      expect(session["workItemId"]).toBe("wi-1");
    });

    it("builds the create input with signalCount 0 and the signal's receivedAt as firstSignalAt", async () => {
      const workItemStore = fakeWorkItemStore();
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);
      const receivedAt = new Date("2026-03-01T00:00:00.000Z");

      await debouncer.processSignal(makeSignal({ receivedAt }));

      expect(workItemStore.createCalls[0]).toMatchObject({
        componentId: "CACHE_01",
        componentType: ComponentType.CACHE,
        severity: Severity.P2,
        firstSignalAt: receivedAt,
        signalCount: 0,
      });
    });
  });

  describe("resolve — cache miss, active work item already exists in the store", () => {
    it("links to the existing work item instead of creating one", async () => {
      const existing = makeWorkItem({ id: "wi-existing" });
      const workItemStore = fakeWorkItemStore({ findActiveByComponentId: () => Promise.resolve([existing]) });
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-existing", created: false });
      expect(workItemStore.createCalls).toHaveLength(0);
    });
  });

  describe("resolve — valid cached session (fast path)", () => {
    it("links via the cache without touching the work item store at all", async () => {
      const workItemStore = fakeWorkItemStore();
      const redis = new FakeRedis();
      redis.seedSessionHash("CACHE_01", { workItemId: "wi-cached", count: "3", startedAtMs: String(Date.now()) });
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-cached", created: false });
      expect(workItemStore.findActiveCalls).toHaveLength(0);
      expect(workItemStore.createCalls).toHaveLength(0);

      const session = await redis.hgetall("debounce:session:CACHE_01");
      expect(session["count"]).toBe("4"); // bumped by one
    });

    it("treats a session at or past the count threshold as invalid and re-verifies against the store", async () => {
      const existing = makeWorkItem({ id: "wi-existing" });
      const workItemStore = fakeWorkItemStore({ findActiveByComponentId: () => Promise.resolve([existing]) });
      const redis = new FakeRedis();
      redis.seedSessionHash("CACHE_01", { workItemId: "wi-cached", count: "100", startedAtMs: String(Date.now()) });
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, {
        ...BASE_OPTIONS,
        threshold: 100,
      });

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-existing", created: false });
      expect(workItemStore.findActiveCalls).toHaveLength(1);
    });

    it("treats a session whose window has elapsed as invalid and re-verifies against the store", async () => {
      const existing = makeWorkItem({ id: "wi-existing" });
      const workItemStore = fakeWorkItemStore({ findActiveByComponentId: () => Promise.resolve([existing]) });
      const redis = new FakeRedis();
      const longAgo = Date.now() - 20_000; // older than windowSeconds(10) * 1000
      redis.seedSessionHash("CACHE_01", { workItemId: "wi-cached", count: "1", startedAtMs: String(longAgo) });
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-existing", created: false });
      expect(workItemStore.findActiveCalls).toHaveLength(1);
    });

    it("treats a session with no workItemId field as a cache miss", async () => {
      const workItemStore = fakeWorkItemStore();
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      const result = await debouncer.processSignal(makeSignal());

      expect(result.created).toBe(true); // proves the miss path ran (no pre-seeded session to link to)
    });
  });

  describe("create races with another worker", () => {
    it("links to the winner's work item when create() throws the active-component unique-constraint conflict", async () => {
      const winner = makeWorkItem({ id: "wi-winner" });
      const workItemStore = fakeWorkItemStore({
        // First check (before create): nothing active yet. After the
        // conflict, the winner the other worker created is now visible.
        findActiveByComponentId: sequencedFindActive([], [winner]),
        createWorkItem: () => Promise.reject(conflictError()),
      });
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-winner", created: false });
    });

    it("rethrows a create failure that isn't a recognized conflict", async () => {
      const boom = new Error("connection reset");
      const workItemStore = fakeWorkItemStore({ createWorkItem: () => Promise.reject(boom) });
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      await expect(debouncer.processSignal(makeSignal())).rejects.toBe(boom);
    });

    it("throws a descriptive error if a conflict occurs but no active work item is found afterward", async () => {
      const workItemStore = fakeWorkItemStore({
        findActiveByComponentId: () => Promise.resolve([]), // never sees a winner, even after the "conflict"
        createWorkItem: () => Promise.reject(conflictError()),
      });
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      await expect(debouncer.processSignal(makeSignal())).rejects.toThrow(
        /conflicted for component .* but no active work item was found/,
      );
    });

    it("honors a custom isConflictError predicate instead of the default unique-constraint check", async () => {
      class CustomConflict extends Error {}
      const winner = makeWorkItem({ id: "wi-winner" });
      const workItemStore = fakeWorkItemStore({
        findActiveByComponentId: sequencedFindActive([], [winner]),
        createWorkItem: () => Promise.reject(new CustomConflict("mock conflict")),
      });
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, {
        ...BASE_OPTIONS,
        isConflictError: (error: unknown): boolean => error instanceof CustomConflict,
      });

      const result = await debouncer.processSignal(makeSignal());
      expect(result).toEqual({ workItemId: "wi-winner", created: false });
    });
  });

  describe("lock contention", () => {
    it("releases the creation lock after resolving, even when the store call succeeds", async () => {
      const workItemStore = fakeWorkItemStore();
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      await debouncer.processSignal(makeSignal());

      expect(redis.isLocked("CACHE_01")).toBe(false);
    });

    it("releases the creation lock even when the store call throws a non-conflict error", async () => {
      const workItemStore = fakeWorkItemStore({ createWorkItem: () => Promise.reject(new Error("boom")) });
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, BASE_OPTIONS);

      await expect(debouncer.processSignal(makeSignal())).rejects.toThrow("boom");

      expect(redis.isLocked("CACHE_01")).toBe(false);
    });

    it("waits for the lock holder's session to appear, then links to it, when it can't acquire the lock itself", async () => {
      const workItemStore = fakeWorkItemStore();
      const redis = new FakeRedis();
      redis.holdLock("CACHE_01"); // simulate another worker mid-resolution

      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, {
        ...BASE_OPTIONS,
        lockWaitTimeoutMs: 200,
        lockPollIntervalMs: 10,
      });

      // The "other worker" publishes its session shortly after — simulated
      // by seeding it on a short timer while pollForSession is looping.
      setTimeout(() => {
        redis.seedSessionHash("CACHE_01", { workItemId: "wi-other-worker", count: "0", startedAtMs: String(Date.now()) });
      }, 30);

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-other-worker", created: false });
      expect(workItemStore.createCalls).toHaveLength(0);
    });

    it("gives up and resolves independently once the lock-wait timeout elapses with no session appearing", async () => {
      const workItemStore = fakeWorkItemStore();
      const redis = new FakeRedis();
      redis.holdLock("CACHE_01"); // held for the entire test — never released, never seeded

      const debouncer = new SignalDebouncer(workItemStore, fakeSignalStore(), redis as unknown as Redis, {
        ...BASE_OPTIONS,
        lockWaitTimeoutMs: 40,
        lockPollIntervalMs: 10,
      });

      const result = await debouncer.processSignal(makeSignal());

      expect(result).toEqual({ workItemId: "wi-1", created: true }); // resolved independently via the store
      expect(workItemStore.createCalls).toHaveLength(1);
    });
  });

  describe("resolveBatch", () => {
    it("resolves every signal in order without persisting (no Mongo/Postgres writes)", async () => {
      const workItemStore = fakeWorkItemStore();
      const signalStore = fakeSignalStore();
      const redis = new FakeRedis();
      const debouncer = new SignalDebouncer(workItemStore, signalStore, redis as unknown as Redis, BASE_OPTIONS);

      const signals = [makeSignal({ signalId: "a" }), makeSignal({ signalId: "b" }), makeSignal({ signalId: "c" })];
      const results = await debouncer.resolveBatch(signals);

      expect(results).toHaveLength(3);
      expect(results[0]?.created).toBe(true);
      expect(results[1]?.created).toBe(false);
      expect(results[2]?.created).toBe(false);
      expect(signalStore.insertedBatches).toHaveLength(0); // resolveBatch never calls persist()
      expect(workItemStore.incrementCalls).toHaveLength(0);
    });
  });
});

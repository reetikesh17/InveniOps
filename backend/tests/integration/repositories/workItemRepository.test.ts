import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, WorkItemStatus, Severity, ComponentType, RootCauseCategory } from "@prisma/client";
import {
  PostgresWorkItemRepository,
  OptimisticConcurrencyError,
  type CreateWorkItemInput,
  type SubmitRcaInput,
} from "../../../src/repositories/postgres/index.js";
import { TEST_DATABASE_URL } from "../testEnv.js";

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const repo = new PostgresWorkItemRepository(prisma);

async function cleanDatabase(): Promise<void> {
  await prisma.stateTransition.deleteMany();
  await prisma.rcaRecord.deleteMany();
  await prisma.workItem.deleteMany();
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanDatabase();
});

afterEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function baseWorkItemInput(overrides: Partial<CreateWorkItemInput> = {}): CreateWorkItemInput {
  return {
    componentId: "CACHE_CLUSTER_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    title: "Cache cluster degraded",
    firstSignalAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const RCA_TEXT = "Restarted the connection pool after exhausting max connections.";

function validRcaInput(): SubmitRcaInput["rca"] {
  return {
    incidentStartTime: new Date("2026-01-01T01:00:00.000Z"),
    incidentEndTime: new Date("2026-01-01T02:00:00.000Z"),
    rootCauseCategory: RootCauseCategory.INFRASTRUCTURE_FAILURE,
    rootCauseDescription: RCA_TEXT,
    fixApplied: RCA_TEXT,
    preventionSteps: RCA_TEXT,
  };
}

async function moveToResolved(workItemId: string): Promise<void> {
  await repo.transitionState({
    workItemId,
    fromState: WorkItemStatus.OPEN,
    toState: WorkItemStatus.INVESTIGATING,
    actor: "test-setup",
  });
  await repo.transitionState({
    workItemId,
    fromState: WorkItemStatus.INVESTIGATING,
    toState: WorkItemStatus.RESOLVED,
    actor: "test-setup",
  });
}

describe("PostgresWorkItemRepository", () => {
  describe("createWorkItem", () => {
    it("creates a work item defaulting to OPEN with signalCount 1", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());

      expect(workItem.state).toBe(WorkItemStatus.OPEN);
      expect(workItem.signalCount).toBe(1);
      expect(workItem.componentId).toBe("CACHE_CLUSTER_01");
    });
  });

  describe("findActiveByComponentId", () => {
    it("returns only work items for the given component", async () => {
      const target = await repo.createWorkItem(baseWorkItemInput({ componentId: "COMP_A" }));
      await repo.createWorkItem(baseWorkItemInput({ componentId: "COMP_B" }));

      const results = await repo.findActiveByComponentId("COMP_A");

      expect(results.map((w) => w.id)).toEqual([target.id]);
    });

    it("excludes CLOSED work items", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput({ componentId: "COMP_C" }));
      await moveToResolved(workItem.id);
      await repo.submitRca({
        workItemId: workItem.id,
        actor: "test",
        rca: validRcaInput(),
        mttrSeconds: 100,
      });

      const results = await repo.findActiveByComponentId("COMP_C");

      expect(results).toHaveLength(0);
    });
  });

  describe("findById", () => {
    it("returns null for a nonexistent id", async () => {
      expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("includes a null rca before one is submitted", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());

      const found = await repo.findById(workItem.id);

      expect(found?.rca).toBeNull();
    });

    it("includes the rca relation once submitted", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());
      await moveToResolved(workItem.id);
      await repo.submitRca({
        workItemId: workItem.id,
        actor: "test",
        rca: validRcaInput(),
        mttrSeconds: 3600,
      });

      const found = await repo.findById(workItem.id);

      expect(found?.state).toBe(WorkItemStatus.CLOSED);
      expect(found?.rca?.rootCauseCategory).toBe(RootCauseCategory.INFRASTRUCTURE_FAILURE);
    });
  });

  describe("listActive", () => {
    it("sorts by severity then firstSignalAt, and paginates", async () => {
      const p0Old = await repo.createWorkItem(
        baseWorkItemInput({ componentId: "A", severity: Severity.P0, firstSignalAt: new Date("2026-01-01T00:00:00.000Z") }),
      );
      const p0New = await repo.createWorkItem(
        baseWorkItemInput({ componentId: "B", severity: Severity.P0, firstSignalAt: new Date("2026-01-02T00:00:00.000Z") }),
      );
      const p2 = await repo.createWorkItem(
        baseWorkItemInput({ componentId: "C", severity: Severity.P2, firstSignalAt: new Date("2026-01-01T00:00:00.000Z") }),
      );

      const page1 = await repo.listActive({ limit: 2, offset: 0 });
      expect(page1.map((w) => w.id)).toEqual([p0Old.id, p0New.id]);

      const page2 = await repo.listActive({ limit: 2, offset: 2 });
      expect(page2.map((w) => w.id)).toEqual([p2.id]);
    });
  });

  describe("transitionState", () => {
    it("succeeds and writes exactly one audit row when fromState matches", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());

      const updated = await repo.transitionState({
        workItemId: workItem.id,
        fromState: WorkItemStatus.OPEN,
        toState: WorkItemStatus.INVESTIGATING,
        actor: "alice",
      });

      expect(updated.state).toBe(WorkItemStatus.INVESTIGATING);

      const transitions = await prisma.stateTransition.findMany({ where: { workItemId: workItem.id } });
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toMatchObject({
        fromState: WorkItemStatus.OPEN,
        toState: WorkItemStatus.INVESTIGATING,
        actor: "alice",
      });
    });

    it("rejects a stale fromState and writes no audit row", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput()); // actually OPEN

      await expect(
        repo.transitionState({
          workItemId: workItem.id,
          fromState: WorkItemStatus.RESOLVED, // wrong — it's OPEN
          toState: WorkItemStatus.CLOSED,
          actor: "alice",
        }),
      ).rejects.toThrow(OptimisticConcurrencyError);

      const reloaded = await prisma.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
      expect(reloaded.state).toBe(WorkItemStatus.OPEN);

      const transitions = await prisma.stateTransition.findMany({ where: { workItemId: workItem.id } });
      expect(transitions).toHaveLength(0);
    });

    it("does not let two concurrent transitions on the same work item both succeed", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());
      await moveToResolved(workItem.id);

      const [resultA, resultB] = await Promise.allSettled([
        repo.transitionState({
          workItemId: workItem.id,
          fromState: WorkItemStatus.RESOLVED,
          toState: WorkItemStatus.CLOSED,
          actor: "responder-a",
        }),
        repo.transitionState({
          workItemId: workItem.id,
          fromState: WorkItemStatus.RESOLVED,
          toState: WorkItemStatus.CLOSED,
          actor: "responder-b",
        }),
      ]);

      const outcomes = [resultA, resultB];
      const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
      const rejected = outcomes.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OptimisticConcurrencyError);

      const reloaded = await prisma.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
      expect(reloaded.state).toBe(WorkItemStatus.CLOSED);

      const closeTransitions = await prisma.stateTransition.findMany({
        where: { workItemId: workItem.id, toState: WorkItemStatus.CLOSED },
      });
      expect(closeTransitions).toHaveLength(1);
    });
  });

  describe("submitRca", () => {
    it("writes the RCA, sets closedAt/mttrSeconds, and transitions to CLOSED atomically", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());
      await moveToResolved(workItem.id);

      const now = new Date("2026-01-01T05:00:00.000Z");
      const result = await repo.submitRca({
        workItemId: workItem.id,
        actor: "alice",
        rca: validRcaInput(),
        mttrSeconds: 18_000,
        now,
      });

      expect(result.workItem.state).toBe(WorkItemStatus.CLOSED);
      expect(result.workItem.closedAt).toEqual(now);
      expect(result.rca.mttrSeconds).toBe(18_000);
      expect(result.rca.submittedAt).toEqual(now);

      const closeTransitions = await prisma.stateTransition.findMany({
        where: { workItemId: workItem.id, toState: WorkItemStatus.CLOSED },
      });
      expect(closeTransitions).toHaveLength(1);
    });

    it("rejects when the work item is not RESOLVED", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput()); // still OPEN

      await expect(
        repo.submitRca({ workItemId: workItem.id, actor: "alice", rca: validRcaInput(), mttrSeconds: 100 }),
      ).rejects.toThrow(OptimisticConcurrencyError);
    });

    it("rolls back completely if the RCA insert fails after the state update already applied", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());
      await moveToResolved(workItem.id);

      // Pre-seed an RcaRecord directly: the work item is genuinely
      // RESOLVED (so the guarded update inside submitRca legitimately
      // succeeds), but an RcaRecord already exists for it — the insert
      // inside submitRca's transaction then violates the unique
      // constraint on workItemId, *after* the update already ran within
      // that same transaction.
      await prisma.rcaRecord.create({
        data: {
          workItemId: workItem.id,
          ...validRcaInput(),
          mttrSeconds: 1,
        },
      });

      await expect(
        repo.submitRca({ workItemId: workItem.id, actor: "alice", rca: validRcaInput(), mttrSeconds: 999 }),
      ).rejects.toThrow();

      const reloaded = await prisma.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
      expect(reloaded.state).toBe(WorkItemStatus.RESOLVED);
      expect(reloaded.closedAt).toBeNull();

      const rcaRows = await prisma.rcaRecord.findMany({ where: { workItemId: workItem.id } });
      expect(rcaRows).toHaveLength(1);
      expect(rcaRows[0]?.mttrSeconds).toBe(1); // still the pre-seeded row, untouched

      const closeTransitions = await prisma.stateTransition.findMany({
        where: { workItemId: workItem.id, toState: WorkItemStatus.CLOSED },
      });
      expect(closeTransitions).toHaveLength(0);
    });
  });

  describe("incrementSignalCount", () => {
    it("atomically accumulates across multiple calls", async () => {
      const workItem = await repo.createWorkItem(baseWorkItemInput());

      await repo.incrementSignalCount(workItem.id, 5);
      const updated = await repo.incrementSignalCount(workItem.id, 3);

      expect(updated.signalCount).toBe(1 + 5 + 3);
    });
  });
});

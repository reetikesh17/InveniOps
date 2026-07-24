import {
  Prisma,
  WorkItemStatus,
  type PrismaClient,
  type WorkItem,
  type RcaRecord,
  type ComponentType,
  type Severity,
  type RootCauseCategory,
} from "@prisma/client";
import { OptimisticConcurrencyError } from "./errors.js";
import { withPostgresRetry } from "./withPostgresRetry.js";

export interface Pagination {
  readonly limit: number;
  readonly offset: number;
}

export interface CreateWorkItemInput {
  readonly id?: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly title: string;
  readonly firstSignalAt: Date;
  readonly signalCount?: number;
}

export interface TransitionStateInput {
  readonly workItemId: string;
  readonly fromState: WorkItemStatus;
  readonly toState: WorkItemStatus;
  readonly actor: string;
  /** Extra fields to set alongside the state change (e.g. resolvedAt) — the
   *  caller decides what belongs here, this repository has no opinion. */
  readonly data?: Partial<Pick<WorkItem, "resolvedAt" | "closedAt">>;
}

export interface SubmitRcaInput {
  readonly workItemId: string;
  readonly actor: string;
  readonly rca: {
    readonly incidentStartTime: Date;
    readonly incidentEndTime: Date;
    readonly rootCauseCategory: RootCauseCategory;
    readonly rootCauseDescription: string;
    readonly fixApplied: string;
    readonly preventionSteps: string;
  };
  /** Computed by the caller via domain/rca's calculateMttr — this repository
   *  does not import domain logic. */
  readonly mttrSeconds: number;
  /** Injectable for deterministic tests; defaults to the real clock. */
  readonly now?: Date;
}

export interface SubmitRcaResult {
  readonly workItem: WorkItem;
  readonly rca: RcaRecord;
}

export type WorkItemWithRca = WorkItem & { rca: RcaRecord | null };

async function applyGuardedTransition(
  tx: Prisma.TransactionClient,
  params: {
    workItemId: string;
    fromState: WorkItemStatus;
    toState: WorkItemStatus;
    actor: string;
    data?: Partial<Pick<WorkItem, "resolvedAt" | "closedAt">>;
  },
): Promise<void> {
  const { workItemId, fromState, toState, actor, data } = params;

  const result = await tx.workItem.updateMany({
    where: { id: workItemId, state: fromState },
    data: { state: toState, ...data },
  });

  if (result.count === 0) {
    throw new OptimisticConcurrencyError(workItemId, fromState);
  }

  await tx.stateTransition.create({
    data: { workItemId, fromState, toState, actor },
  });
}

export class PostgresWorkItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    return withPostgresRetry(() =>
      this.prisma.workItem.create({
        data: {
          ...(input.id !== undefined ? { id: input.id } : {}),
          componentId: input.componentId,
          componentType: input.componentType,
          severity: input.severity,
          title: input.title,
          firstSignalAt: input.firstSignalAt,
          ...(input.signalCount !== undefined ? { signalCount: input.signalCount } : {}),
        },
      }),
    );
  }

  async findActiveByComponentId(componentId: string): Promise<WorkItem[]> {
    return this.prisma.workItem.findMany({
      where: { componentId, state: { not: WorkItemStatus.CLOSED } },
      orderBy: { firstSignalAt: "asc" },
    });
  }

  async findById(id: string): Promise<WorkItemWithRca | null> {
    return this.prisma.workItem.findUnique({
      where: { id },
      include: { rca: true },
    });
  }

  async listActive(pagination: Pagination): Promise<WorkItem[]> {
    return this.prisma.workItem.findMany({
      where: { state: { not: WorkItemStatus.CLOSED } },
      orderBy: [{ severity: "asc" }, { firstSignalAt: "asc" }],
      take: pagination.limit,
      skip: pagination.offset,
    });
  }

  /**
   * Atomic: guarded state update + audit row insert in one transaction.
   * The update's WHERE clause includes `state: fromState` — under
   * Postgres's READ COMMITTED isolation, a concurrent transaction that
   * changed the row first causes this one to re-evaluate against the new
   * state and match zero rows, so two concurrent callers can never both
   * succeed. Throws OptimisticConcurrencyError if the current state no
   * longer matches fromState (or the work item doesn't exist).
   */
  async transitionState(input: TransitionStateInput): Promise<WorkItem> {
    return withPostgresRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await applyGuardedTransition(tx, input);
        return tx.workItem.findUniqueOrThrow({ where: { id: input.workItemId } });
      }),
    );
  }

  /**
   * Atomic: guarded RESOLVED -> CLOSED transition + RCA insert + audit row,
   * all in one transaction. If the RCA insert fails (e.g. a work item that
   * already has one, violating the unique constraint), the state change
   * applied earlier in this same transaction is rolled back too.
   */
  async submitRca(input: SubmitRcaInput): Promise<SubmitRcaResult> {
    const now = input.now ?? new Date();

    return withPostgresRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await applyGuardedTransition(tx, {
          workItemId: input.workItemId,
          fromState: WorkItemStatus.RESOLVED,
          toState: WorkItemStatus.CLOSED,
          actor: input.actor,
          data: { closedAt: now },
        });

        const rca = await tx.rcaRecord.create({
          data: {
            workItemId: input.workItemId,
            incidentStartTime: input.rca.incidentStartTime,
            incidentEndTime: input.rca.incidentEndTime,
            rootCauseCategory: input.rca.rootCauseCategory,
            rootCauseDescription: input.rca.rootCauseDescription,
            fixApplied: input.rca.fixApplied,
            preventionSteps: input.rca.preventionSteps,
            mttrSeconds: input.mttrSeconds,
            submittedAt: now,
          },
        });

        const workItem = await tx.workItem.findUniqueOrThrow({ where: { id: input.workItemId } });

        return { workItem, rca };
      }),
    );
  }

  async incrementSignalCount(workItemId: string, by: number): Promise<WorkItem> {
    return withPostgresRetry(() =>
      this.prisma.workItem.update({
        where: { id: workItemId },
        data: { signalCount: { increment: by } },
      }),
    );
  }

  /** Work items still OPEN whose first signal is at least this old — the escalation scheduler's candidate query (src/services/alerting/escalationScheduler.ts). */
  async findOpenWorkItemsOlderThan(cutoff: Date): Promise<WorkItem[]> {
    return this.prisma.workItem.findMany({
      where: { state: WorkItemStatus.OPEN, firstSignalAt: { lte: cutoff } },
    });
  }

  /**
   * Records an escalation on the existing state_transitions audit trail
   * without a schema change — fromState/toState are both OPEN (a harmless
   * no-op state update), distinguishable from a real transition by actor.
   * Not run through applyGuardedTransition: escalation doesn't change
   * state, so there's nothing for optimistic concurrency to guard here.
   */
  async recordEscalation(workItemId: string, actor: string): Promise<void> {
    await withPostgresRetry(() =>
      this.prisma.stateTransition.create({
        data: { workItemId, fromState: WorkItemStatus.OPEN, toState: WorkItemStatus.OPEN, actor },
      }),
    );
  }
}

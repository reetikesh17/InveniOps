import type { WorkItem, RootCauseCategory } from "@prisma/client";
import {
  createWorkItemStateGraph,
  InvalidTransitionError,
  type WorkItemSnapshot,
  type WorkItemStateName,
} from "../../domain/state/index.js";
import {
  createRcaCloseGuard,
  validateRca,
  calculateMttr,
  type RcaFieldError,
  type RcaRecord as RcaValidationCandidate,
} from "../../domain/rca/index.js";
import { OptimisticConcurrencyError } from "../../repositories/postgres/index.js";
import type {
  TransitionStateInput,
  SubmitRcaInput,
  SubmitRcaResult,
} from "../../repositories/postgres/workItemRepository.js";
import type { WorkItemWithRca } from "../../repositories/postgres/index.js";

// Narrow, structural interfaces — the real PostgresWorkItemRepository /
// DashboardCacheRepository satisfy these without an adapter, but a unit
// test can substitute fakes and call this service directly, with zero
// real infra, to prove the domain layer (not just this service's own
// checks) is what rejects an illegal CLOSED transition.
export interface WorkItemWorkflowStore {
  findById(id: string): Promise<WorkItemWithRca | null>;
  transitionState(input: TransitionStateInput): Promise<WorkItem>;
  submitRca(input: SubmitRcaInput): Promise<SubmitRcaResult>;
}

export interface WorkflowCache {
  upsertActiveIncident(workItem: WorkItem): Promise<unknown>;
  removeIncident(workItemId: string): Promise<unknown>;
}

export type TransitionOutcome =
  | { readonly outcome: "not_found" }
  | { readonly outcome: "invalid_transition"; readonly message: string }
  | { readonly outcome: "conflict"; readonly message: string }
  | { readonly outcome: "transitioned"; readonly workItem: WorkItem };

export type RcaSubmissionOutcome =
  | { readonly outcome: "not_found" }
  | { readonly outcome: "invalid_rca"; readonly errors: readonly RcaFieldError[] }
  | { readonly outcome: "invalid_state"; readonly message: string }
  | { readonly outcome: "closed"; readonly workItem: WorkItem; readonly mttrSeconds: number };

function toDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  return new Date(value); // possibly an Invalid Date — validateRca's isValidDate rejects that explicitly
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toRcaCandidate(rawInput: unknown): RcaValidationCandidate {
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  return {
    incidentStartTime: toDate(raw["incidentStartTime"]),
    incidentEndTime: toDate(raw["incidentEndTime"]),
    rootCauseCategory: toOptionalString(raw["rootCauseCategory"]),
    rootCauseDescription: toOptionalString(raw["rootCauseDescription"]),
    fixApplied: toOptionalString(raw["fixApplied"]),
    preventionSteps: toOptionalString(raw["preventionSteps"]),
  };
}

function toSnapshot(workItem: WorkItemWithRca): WorkItemSnapshot {
  return { id: workItem.id, state: workItem.state as WorkItemStateName, firstSignalAt: workItem.firstSignalAt };
}

/**
 * Orchestrates the two work-item write paths — plain state transitions and
 * RCA submission — entirely through the domain state machine
 * (src/domain/state/) and RCA validator (src/domain/rca/). Persistence is
 * the existing, already-guarded repository methods
 * (transitionState/submitRca — optimistic concurrency, atomic multi-table
 * writes); this service's job is deciding whether a transition is legal
 * *before* attempting it, and keeping the dashboard cache in sync
 * synchronously with whatever Postgres just committed.
 */
export class WorkflowService {
  constructor(
    private readonly workItemStore: WorkItemWorkflowStore,
    private readonly cache: WorkflowCache,
  ) {}

  async transitionWorkItem(
    workItemId: string,
    toState: WorkItemStateName,
    actor: string,
    now: Date = new Date(),
  ): Promise<TransitionOutcome> {
    const workItem = await this.workItemStore.findById(workItemId);
    if (!workItem) {
      return { outcome: "not_found" };
    }

    const snapshot = toSnapshot(workItem);

    // The canClose guard only matters for a RESOLVED -> CLOSED attempt,
    // which this method can never legitimately produce: no RCA payload is
    // ever supplied here, so createRcaCloseGuard rejects it unconditionally
    // — CLOSED is reachable only through submitIncidentRca below. That's
    // enforced by the domain layer itself, not by this method choosing not
    // to call it — see tests/unit/services/workitems/workflowService.test.ts.
    const graph = createWorkItemStateGraph(createRcaCloseGuard(() => now));
    const currentState = graph[snapshot.state];

    try {
      currentState.transition({ workItem: snapshot, to: toState });
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        return { outcome: "invalid_transition", message: error.message };
      }
      throw error;
    }

    try {
      const updated = await this.workItemStore.transitionState({
        workItemId,
        fromState: snapshot.state,
        toState,
        actor,
        ...(toState === "RESOLVED" ? { data: { resolvedAt: now } } : {}),
      });
      await this.cache.upsertActiveIncident(updated);
      return { outcome: "transitioned", workItem: updated };
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        return { outcome: "conflict", message: error.message };
      }
      throw error;
    }
  }

  async submitIncidentRca(
    workItemId: string,
    rawRcaInput: unknown,
    actor: string,
    now: Date = new Date(),
  ): Promise<RcaSubmissionOutcome> {
    const workItem = await this.workItemStore.findById(workItemId);
    if (!workItem) {
      return { outcome: "not_found" };
    }

    const snapshot = toSnapshot(workItem);
    const rcaCandidate = toRcaCandidate(rawRcaInput);

    // Computed independently of the guard below purely to get field-level
    // detail for a 422 response — the guard (and therefore the actual
    // accept/reject decision) calls this same pure function internally.
    const validation = validateRca(rcaCandidate, { firstSignalAt: workItem.firstSignalAt, now });

    // This is the domain-layer gate: it rejects both an incomplete RCA
    // (via the injected canClose guard) *and* an attempt from a state
    // that was never RESOLVED to begin with, which validateRca alone has
    // no way to know about (it only looks at RCA field content, not work
    // item state). CLOSED is unreachable through this codepath unless
    // this call succeeds.
    const graph = createWorkItemStateGraph(createRcaCloseGuard(() => now));
    const currentState = graph[snapshot.state];

    try {
      currentState.transition({ workItem: snapshot, to: "CLOSED", payload: rcaCandidate });
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) {
        throw error;
      }
      if (!validation.valid) {
        return { outcome: "invalid_rca", errors: validation.errors };
      }
      return {
        outcome: "invalid_state",
        message: `Work item ${workItemId} is in state ${snapshot.state}, which cannot transition to CLOSED.`,
      };
    }

    const mttrResult = calculateMttr(workItem.firstSignalAt, now);
    if (!mttrResult.ok) {
      // Not a client input problem — the RCA was valid and the state was
      // legal; the system's own clocks disagree. Surface loudly (500),
      // not as a field error the client could never fix by resubmitting.
      throw new Error(`MTTR calculation failed for work item ${workItemId}: ${mttrResult.message}`);
    }

    try {
      const { workItem: closedWorkItem } = await this.workItemStore.submitRca({
        workItemId,
        actor,
        rca: {
          incidentStartTime: rcaCandidate.incidentStartTime!,
          incidentEndTime: rcaCandidate.incidentEndTime!,
          rootCauseCategory: rcaCandidate.rootCauseCategory as RootCauseCategory,
          rootCauseDescription: rcaCandidate.rootCauseDescription!,
          fixApplied: rcaCandidate.fixApplied!,
          preventionSteps: rcaCandidate.preventionSteps!,
        },
        mttrSeconds: mttrResult.mttrSeconds,
        now,
      });

      // CLOSED work items are intentionally excluded from the
      // active-incident cache (see docs/data-model.md) — remove, not upsert.
      await this.cache.removeIncident(workItemId);

      return { outcome: "closed", workItem: closedWorkItem, mttrSeconds: mttrResult.mttrSeconds };
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        return { outcome: "invalid_state", message: error.message };
      }
      throw error;
    }
  }
}

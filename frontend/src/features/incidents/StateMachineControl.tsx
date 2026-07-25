import { useState } from "react";
import { Button, StateBadge } from "../../components";
import { api, ApiRequestError } from "../../lib/api";
import type { WorkItemState } from "../../types";

// Cosmetic only — how to word the button for a given target state. Which
// states are actually reachable comes entirely from the server's
// legalNextStates; this map never decides that, only how to phrase it.
const TARGET_LABELS: Partial<Record<WorkItemState, string>> = {
  INVESTIGATING: "Start investigating",
  RESOLVED: "Mark resolved",
  OPEN: "Reopen",
};

// CLOSED is the one target that always requires an RCA payload — the
// generic POST /transition endpoint never accepts one, so the domain layer
// unconditionally rejects a bare "toState: CLOSED" attempt through it (see
// backend/src/services/workitems/workflowService.ts's comment on
// createRcaCloseGuard). Rather than firing a request that's guaranteed to
// 409, this control never renders a plain button for it at all — the
// RESOLVED-state RCA call-to-action (rendered by the parent) is the only
// path to CLOSED.
function isDataCarryingTarget(target: WorkItemState): boolean {
  return target === "CLOSED";
}

export interface StateMachineControlProps {
  readonly incidentId: string;
  readonly legalNextStates: readonly WorkItemState[];
  readonly actor: string;
  readonly onTransitioned: () => void;
  readonly onConflict: (message: string) => void;
}

export function StateMachineControl({
  incidentId,
  legalNextStates,
  actor,
  onTransitioned,
  onConflict,
}: StateMachineControlProps): JSX.Element | null {
  const [pendingTarget, setPendingTarget] = useState<WorkItemState | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const renderableTargets = legalNextStates.filter((target) => !isDataCarryingTarget(target));
  if (renderableTargets.length === 0) {
    return null;
  }

  async function handleClick(target: WorkItemState): Promise<void> {
    setPendingTarget(target);
    setGeneralError(null);
    try {
      await api.transitionIncident(incidentId, target, actor);
      onTransitioned();
    } catch (err) {
      if (err instanceof ApiRequestError && err.info.kind === "conflict") {
        // Covers both the optimistic-concurrency race and the "this target
        // is no longer legal from the real current state" race — on this
        // endpoint a 409 only ever means one of those two, and both boil
        // down to "someone else moved this incident concurrently".
        onConflict("This incident was updated by someone else — showing the latest state.");
      } else if (err instanceof ApiRequestError) {
        setGeneralError(err.info.message);
      } else {
        setGeneralError("Something went wrong changing this incident's state.");
      }
    } finally {
      setPendingTarget(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {renderableTargets.map((target) => (
          <Button
            key={target}
            variant="primary"
            loading={pendingTarget === target}
            disabled={pendingTarget !== null && pendingTarget !== target}
            onClick={() => void handleClick(target)}
          >
            {TARGET_LABELS[target] ?? (
              <>
                Move to <StateBadge state={target} className="ml-1" />
              </>
            )}
          </Button>
        ))}
      </div>
      {generalError && <p className="text-sm text-red-700">{generalError}</p>}
    </div>
  );
}

import type { TransitionContext, TransitionGuard } from "../state/types.js";
import { validateRca } from "./validateRca.js";
import type { RcaRecord } from "./types.js";

function isRcaRecord(value: unknown): value is RcaRecord {
  return typeof value === "object" && value !== null;
}

// Bridges validateRca's discriminated result to the boolean shape
// TransitionGuard expects. `clock` is injected rather than calling
// `new Date()` inline, so this stays deterministic and testable — pass
// `() => new Date()` at real wiring time, a fixed-date function in tests.
export function createRcaCloseGuard(clock: () => Date): TransitionGuard {
  return (context: TransitionContext): boolean => {
    if (!isRcaRecord(context.payload)) {
      return false;
    }

    const result = validateRca(context.payload, {
      firstSignalAt: context.workItem.firstSignalAt,
      now: clock(),
    });

    return result.valid;
  };
}

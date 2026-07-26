import { useEffect, useState } from "react";
import { EmptyState, ErrorState, RelativeTime, SkeletonBlock, StateBadge } from "../../components";
import { api, ApiRequestError, type ApiErrorInfo } from "../../lib/api";
import { friendlyErrorMessage } from "../../lib/errorMessages";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import type { StateTransition } from "../../types";

function toErrorInfo(error: unknown): ApiErrorInfo {
  if (error instanceof ApiRequestError) {
    return error.info;
  }
  return { kind: "unknown", status: 0, message: error instanceof Error ? error.message : "unexpected error" };
}

export interface TransitionTimelineProps {
  readonly incidentId: string;
}

/** Who/what/when, from the StateTransition audit trail (GET /:id/transitions) — never paginated, an incident accumulates at most a handful of these. */
export function TransitionTimeline({ incidentId }: TransitionTimelineProps): JSX.Element | null {
  const [transitions, setTransitions] = useState<readonly StateTransition[] | null>(null);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Aborted on unmount / incident change so a late response never updates a
  // torn-down timeline.
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api
      .getIncidentTransitions(incidentId, { signal: controller.signal })
      .then(({ items }) => {
        if (!controller.signal.aborted) {
          setTransitions(items);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setError(toErrorInfo(err));
      });
    return () => controller.abort();
  }, [incidentId, reloadNonce]);

  const showSkeleton = useDelayedFlag(transitions === null && error === null);

  if (error) {
    return (
      <ErrorState message={friendlyErrorMessage(error, "the transition history")} onRetry={() => setReloadNonce((n) => n + 1)} />
    );
  }

  if (transitions === null) {
    return showSkeleton ? (
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-10 w-full" />
        <SkeletonBlock className="h-10 w-full" />
      </div>
    ) : null;
  }

  if (transitions.length === 0) {
    return <EmptyState headline="No transitions yet" body="This incident hasn't changed state since it was opened." />;
  }

  return (
    <ol className="flex flex-col gap-3">
      {transitions.map((transition) => {
        const isEscalation = transition.fromState === transition.toState;
        return (
          <li key={transition.id} className="flex items-start gap-3 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {isEscalation ? (
                  <>
                    <span className="text-ink-muted">Escalated while</span>
                    <StateBadge state={transition.toState} />
                  </>
                ) : (
                  <>
                    <StateBadge state={transition.fromState} />
                    <span className="text-ink-faint" aria-hidden="true">
                      →
                    </span>
                    <StateBadge state={transition.toState} />
                  </>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                {transition.actor} ·{" "}
                <RelativeTime value={transition.occurredAt} className="font-mono text-mono-micro tabular-nums" />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

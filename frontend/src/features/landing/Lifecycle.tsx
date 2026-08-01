import { StateBadge } from "../../components";
import { EYEBROW_CLASSES } from "../../components/typography";
import type { WorkItemState } from "../../types";

const STATES: readonly WorkItemState[] = ["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"];

const STATE_NOTE: Record<WorkItemState, string> = {
  OPEN: "A work item exists — created by the debounce session, not a human.",
  INVESTIGATING: "A responder has picked it up.",
  RESOLVED: "The fix is in. Closing still isn't legal yet.",
  CLOSED: "Only reachable with a complete RCA — enforced in the domain layer.",
};

export function Lifecycle(): JSX.Element {
  return (
    <section className="border-t border-border py-16 md:py-section" aria-labelledby="lifecycle-heading">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <h2 id="lifecycle-heading" className={`${EYEBROW_CLASSES} tracking-widest`}>
          Lifecycle
        </h2>
        <p className="mt-3 max-w-2xl font-body text-lede text-ink-muted">
          One legal path forward. The State pattern — one class per state, in{" "}
          <code className="font-mono text-prose text-ink">backend/src/domain/state/</code> — declares
          its own outbound transitions; nothing here is an if/else chain.
        </p>

        <ol className="mt-8 flex flex-col sm:flex-row sm:items-start">
          {STATES.map((state, i) => (
            <li key={state} className="flex flex-1 items-start gap-2">
              <div className="flex flex-1 flex-col gap-2 border-l-2 border-border-strong py-3 pl-4 sm:border-l-0 sm:border-t-2 sm:py-0 sm:pl-0 sm:pt-4">
                <StateBadge state={state} className="w-fit" />
                <p className="max-w-[16rem] font-body text-prose text-ink-muted">{STATE_NOTE[state]}</p>
              </div>
              {i < STATES.length - 1 && (
                <span className="hidden shrink-0 pt-4 text-ink-faint sm:block" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

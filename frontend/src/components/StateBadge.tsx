import type { WorkItemState } from "../types";

const LABEL: Record<WorkItemState, string> = {
  OPEN: "open",
  INVESTIGATING: "investigating",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

export interface StateBadgeProps {
  readonly state: WorkItemState;
  readonly className?: string;
}

/**
 * Workflow state is context, not urgency, so it gets NO colour — colour is
 * rationed to severity. A quiet lowercase mono label inside a hairline
 * outline; CLOSED recedes further (no border — dropping the outline, not the
 * text colour, since ink-faint fails AA text contrast at this size; see
 * docs/decisions/0008-console-visual-system.md). Never competes with the
 * severity spine for the eye.
 */
export function StateBadge({ state, className = "" }: StateBadgeProps): JSX.Element {
  const isClosed = state === "CLOSED";
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-mono-micro lowercase tracking-tight text-ink-muted ${
        isClosed ? "" : "border border-border-strong"
      } ${className}`}
    >
      {LABEL[state]}
    </span>
  );
}

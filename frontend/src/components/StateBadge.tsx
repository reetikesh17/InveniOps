import type { WorkItemState } from "../types";
import { ArchiveIcon, CheckCircleIcon, ClockIcon, DotIcon, type IconProps } from "./icons";

interface StateConfig {
  readonly label: string;
  readonly className: string;
  readonly Icon: (props: IconProps) => JSX.Element;
}

// CLOSED intentionally uses a muted neutral fill rather than a saturated
// colour — closed items should visually recede in a dense active list, not
// compete with items that still need attention.
const CONFIG: Record<WorkItemState, StateConfig> = {
  OPEN: { label: "Open", className: "bg-state-open text-white", Icon: DotIcon },
  INVESTIGATING: { label: "Investigating", className: "bg-state-investigating text-white", Icon: ClockIcon },
  RESOLVED: { label: "Resolved", className: "bg-state-resolved text-white", Icon: CheckCircleIcon },
  CLOSED: { label: "Closed", className: "bg-neutral-200 text-ink-muted", Icon: ArchiveIcon },
};

export interface StateBadgeProps {
  readonly state: WorkItemState;
  readonly className?: string;
}

/** Icon + text label per state — a distinct shape per state, not just colour, same reasoning as SeverityBadge. */
export function StateBadge({ state, className = "" }: StateBadgeProps): JSX.Element {
  const config = CONFIG[state];
  const { Icon } = config;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold ${config.className} ${className}`}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {config.label}
    </span>
  );
}

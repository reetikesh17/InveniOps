import type { ReactNode } from "react";
import { InboxIcon } from "./icons";

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly headline: string;
  readonly body?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ icon, headline, body, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      <div className="text-ink-faint">{icon ?? <InboxIcon />}</div>
      <p className="text-sm font-semibold text-ink">{headline}</p>
      {body && <p className="text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

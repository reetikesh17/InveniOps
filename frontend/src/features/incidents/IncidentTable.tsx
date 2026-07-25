import { useEffect, useRef, useState } from "react";
import type { WorkItem } from "../../types";
import { IncidentRow } from "./IncidentRow";

// Long enough to be noticed, short enough not to distract from the next
// arrival landing on top of it.
const HIGHLIGHT_MS = 2_500;

export interface IncidentTableProps {
  readonly incidents: readonly WorkItem[];
}

function HeaderCell({ className, children }: { className: string; children: string }): JSX.Element {
  return (
    <div role="columnheader" className={`text-xs font-medium uppercase tracking-wide text-ink-faint ${className}`}>
      {children}
    </div>
  );
}

/**
 * Renders the already backend-sorted incident list as-is — never re-sorts
 * client side (see useIncidents / the SSE ADR). New incidents (ids not
 * present on the previous render) get a brief entrance animation + tint
 * (IncidentRow's `isNew`); everything else just re-renders in place.
 * item.id as the React key is what keeps this an update rather than a
 * remount, so the page's scroll position survives every refresh.
 */
export function IncidentTable({ incidents }: IncidentTableProps): JSX.Element {
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(incidents.map((incident) => incident.id));

    if (seenIdsRef.current === null) {
      // First load ever: nothing is "new" yet, there's no prior render to diff against.
      seenIdsRef.current = currentIds;
      return;
    }

    const previouslySeen = seenIdsRef.current;
    const arrived = incidents.map((incident) => incident.id).filter((id) => !previouslySeen.has(id));
    seenIdsRef.current = currentIds;

    if (arrived.length === 0) {
      return;
    }

    setNewIds((current) => new Set([...current, ...arrived]));
    const timer = setTimeout(() => {
      setNewIds((current) => {
        const next = new Set(current);
        for (const id of arrived) {
          next.delete(id);
        }
        return next;
      });
    }, HIGHLIGHT_MS);

    return () => clearTimeout(timer);
  }, [incidents]);

  return (
    <div role="table" aria-label="Active incidents" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div role="row" className="hidden gap-3 border-b border-border bg-surface-muted px-3 py-2 sm:flex">
        <HeaderCell className="w-16">Severity</HeaderCell>
        <HeaderCell className="w-28">State</HeaderCell>
        <HeaderCell className="w-36 shrink-0">Component</HeaderCell>
        <HeaderCell className="flex-1">Title</HeaderCell>
        <HeaderCell className="w-20 text-right">Signals</HeaderCell>
        <HeaderCell className="w-24">First seen</HeaderCell>
        <HeaderCell className="w-28">In state</HeaderCell>
      </div>
      <div role="rowgroup" className="divide-y divide-border">
        {incidents.map((incident) => (
          <IncidentRow key={incident.id} incident={incident} isNew={newIds.has(incident.id)} />
        ))}
      </div>
    </div>
  );
}

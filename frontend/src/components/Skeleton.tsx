// One skeleton per major layout, not a generic spinner — each mirrors the
// actual shape of the content it stands in for, so the page doesn't visibly
// jump/reflow once real data arrives. SkeletonBlock is the one shared
// primitive every layout-specific skeleton below is built from.

export function SkeletonBlock({ className = "" }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded-sm bg-border ${className}`} aria-hidden="true" />;
}

/**
 * Stands in for the Live Feed's incident list. Matches that list's
 * responsive shape: a table-like row on wide viewports, a stacked card on
 * narrow ones (see the "tables collapse to cards" constraint) — the
 * skeleton itself reflows the same way the real list will.
 */
export function IncidentListSkeleton({ rows = 8 }: { rows?: number }): JSX.Element {
  return (
    <div
      className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface"
      role="status"
      aria-label="Loading incidents"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
          <SkeletonBlock className="h-5 w-16" />
          <SkeletonBlock className="h-4 w-32 sm:w-40" />
          <SkeletonBlock className="h-4 flex-1" />
          <SkeletonBlock className="h-5 w-24" />
          <SkeletonBlock className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Stands in for the Incident Detail page: header, summary fields, signal list. */
export function IncidentDetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading incident">
      <div className="flex flex-wrap items-center gap-3">
        <SkeletonBlock className="h-6 w-16" />
        <SkeletonBlock className="h-6 w-20" />
        <SkeletonBlock className="h-6 w-64 max-w-full" />
      </div>
      <SkeletonBlock className="h-4 w-48" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { Card, EmptyState, ErrorState, SkeletonBlock } from "../../components";
import { BarChartIcon } from "./analyticsIcons";
import { friendlyErrorMessage } from "../../lib/errorMessages";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import type { ApiErrorInfo } from "../../lib/api";

export const CHART_HEIGHT = 260;

export interface PanelShellProps {
  readonly title: string;
  readonly description?: string;
  /** Right-aligned per-panel controls (a groupBy toggle, a series selector). */
  readonly controls?: ReactNode;
  readonly loading: boolean;
  readonly error: ApiErrorInfo | null;
  readonly isEmpty: boolean;
  readonly onRetry: () => void;
  readonly emptyMessage?: string;
  readonly children: ReactNode;
}

/**
 * Every analytics panel's frame: a titled Card that resolves the four states
 * uniformly — skeleton while loading, ErrorState (with retry) on failure, a
 * calm EmptyState for an empty range (never a broken axis), and the chart
 * only once there's data to draw.
 */
export function PanelShell({
  title,
  description,
  controls,
  loading,
  error,
  isEmpty,
  onRetry,
  emptyMessage = "No data in this time range.",
  children,
}: PanelShellProps): JSX.Element {
  const showSkeleton = useDelayedFlag(loading);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="font-body text-prose text-ink-muted">{description}</p>}
        </div>
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" style={{ minHeight: CHART_HEIGHT }} role="status" aria-label={`Loading ${title}`}>
          {showSkeleton && <SkeletonBlock className="h-full min-h-[220px] w-full" />}
        </div>
      ) : error ? (
        <ErrorState message={friendlyErrorMessage(error, title.toLowerCase())} onRetry={onRetry} />
      ) : isEmpty ? (
        <div className="flex items-center justify-center" style={{ minHeight: CHART_HEIGHT }}>
          <EmptyState icon={<BarChartIcon className="h-8 w-8" />} headline="Nothing to chart yet" body={emptyMessage} />
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

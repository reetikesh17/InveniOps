import { Button } from "./Button";
import { ExclamationTriangleIcon } from "./icons";

export interface ErrorStateProps {
  /** What failed — plain language, not a raw error/stack. */
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Retry",
}: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-6 py-10 text-center"
    >
      {/* The P0 severity hue is the app's only "critical" colour — reuse it, don't introduce raw red. */}
      <ExclamationTriangleIcon className="h-7 w-7 text-severity-p0" />
      <p className="max-w-md font-body text-prose text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

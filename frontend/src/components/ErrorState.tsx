import { Button } from "./Button";
import { ExclamationTriangleIcon } from "./icons";

export interface ErrorStateProps {
  /** What failed — plain language, not a raw error/stack. */
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function ErrorState({ message, onRetry, retryLabel = "Retry" }: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center"
    >
      <ExclamationTriangleIcon className="h-8 w-8 text-red-500" />
      <p className="text-sm font-medium text-red-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

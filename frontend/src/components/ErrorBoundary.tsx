import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { Card } from "./Card";
import { ExclamationTriangleIcon } from "./icons";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Shown in the fallback so the operator knows which screen failed. */
  readonly label?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Catches render/lifecycle errors in the subtree so one screen throwing
 * degrades to a recoverable card, never a white page. "Try again" clears the
 * caught error and re-renders the children — enough to recover from a
 * transient render fault; a persistent one simply re-catches. Wrapped around
 * each route element (see App.tsx), so a crash on one route never takes down
 * the shell (header, nav, health banner all keep working).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry sink in this project — surface it to the console so it's
    // still diagnosable in dev/prod, rather than swallowed.
    console.error("Route error boundary caught:", error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <ExclamationTriangleIcon className="h-8 w-8 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-ink">
              {this.props.label ? `Something went wrong loading ${this.props.label}.` : "Something went wrong on this screen."}
            </p>
            <p className="mt-1 text-sm text-ink-muted">The rest of the app is still working — you can retry this screen.</p>
          </div>
          <Button variant="secondary" onClick={this.handleReset}>
            Try again
          </Button>
        </Card>
      );
    }
    return this.props.children;
  }
}

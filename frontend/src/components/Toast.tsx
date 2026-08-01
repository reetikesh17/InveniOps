import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircleIcon, XCircleIcon } from "./icons";

export type ToastVariant = "success" | "error";

interface ToastItem {
  readonly id: number;
  readonly variant: ToastVariant;
  readonly message: string;
}

interface ToastContextValue {
  showToast: (variant: ToastVariant, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5_000;

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }): JSX.Element {
  const isSuccess = toast.variant === "success";
  // Success is neutral (no green — colour is rationed to severity); error
  // borrows the P0 hue on its rail + icon.
  return (
    <div
      role="status"
      style={{ borderLeftColor: isSuccess ? "var(--color-ink-muted)" : "var(--color-severity-p0)" }}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border border-border border-l-[3px] bg-surface-raised px-3 py-2.5 text-ink shadow-lg"
    >
      {isSuccess ? (
        <CheckCircleIcon className="h-5 w-5 shrink-0 text-ink-muted" />
      ) : (
        <XCircleIcon className="h-5 w-5 shrink-0 text-severity-p0" />
      )}
      <span className="flex-1 pt-0.5 font-body text-prose">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded-sm text-lg leading-none text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ink focus-visible:ring-offset-surface-raised"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Mount once, near the app root (see App.tsx) — everything below can then
 * call useToast() to surface transient success/failure feedback (e.g. "RCA
 * submitted" or "Transition failed: conflict") without threading toast
 * state through props.
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, message: string): void => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, variant, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

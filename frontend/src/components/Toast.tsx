import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
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
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
        isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"
      }`}
    >
      {isSuccess ? (
        <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" />
      ) : (
        <XCircleIcon className="h-5 w-5 shrink-0 text-red-600" />
      )}
      <span className="flex-1 pt-0.5">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded text-lg leading-none text-current/60 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
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

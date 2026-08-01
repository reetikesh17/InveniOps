import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Redirects to /login when there's no authenticated session, preserving
 * the URL the caller was actually trying to reach (via location state) so
 * LoginPage can send them back there on success instead of always landing
 * on "/app". "loading" renders nothing rather than redirecting — this system
 * has no rehydration step today (see hooks/useAuth.tsx), so in practice
 * status is never "loading" by the time this renders, but treating it as
 * "wait, don't redirect yet" rather than "anonymous" is the correct
 * behavior if/when that changes.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return null;
  }

  if (status === "anonymous") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

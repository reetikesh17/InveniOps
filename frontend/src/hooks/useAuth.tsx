import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAuthToken, setUnauthorizedHandler } from "../lib/api";
import type { User } from "../types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: User | null;
  // Function-typed properties, not method-shorthand signatures — the
  // latter carries implicit `this` semantics that trip
  // @typescript-eslint/unbound-method the moment a consumer destructures
  // `login`/`logout` off this object (every consumer does), even though
  // these are plain useCallback closures that never read `this`.
  readonly login: (email: string, password: string) => Promise<void>;
  readonly signup: (email: string, password: string, name: string) => Promise<void>;
  readonly logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The token lives only in this component's state — never localStorage or
 * sessionStorage. That's a deliberate tradeoff, not an oversight:
 *
 * - No persistent-storage exposure: a token in localStorage sits there
 *   readable by any script that ever runs on the page, for as long as the
 *   token is valid, across tabs and reloads — a much longer and wider
 *   window than "while this tab is open." An in-memory token is gone the
 *   moment the tab closes or reloads.
 * - No CSRF surface: this is a bearer token attached explicitly to an
 *   Authorization header by this app's own fetch code (see lib/api.ts),
 *   never an ambient credential the browser attaches automatically the
 *   way a cookie would. A cross-site form or `<img>` tag cannot make a
 *   request carry it.
 * - What this does NOT solve: a live XSS payload running in this page can
 *   still read this in-memory token for as long as the tab is open, same
 *   as it could call any authenticated API directly through this same
 *   AuthContext. In-memory storage narrows the exposure window; it does
 *   not eliminate XSS as a risk.
 * - The real cost: a page reload always loses the session (status starts
 *   "loading" → "anonymous" until the next login) — there is no
 *   refresh-token flow in this system to silently re-establish it. See
 *   docs/decisions/ for that as stated scope, not a missing feature.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>("anonymous");
  const [user, setUser] = useState<User | null>(null);

  const applySession = useCallback((nextUser: User, token: string): void => {
    setAuthToken(token);
    setUser(nextUser);
    setStatus("authenticated");
  }, []);

  const logout = useCallback((): void => {
    // Best-effort, fired while the token is still attached — with no
    // server-side session there's nothing this can fail to invalidate, and
    // the client-side logout below happens regardless of its outcome. Must
    // run before clearing the token, or the call itself 401s (see
    // AUTH_PATHS_EXEMPT_FROM_UNAUTHORIZED_HANDLER in lib/api.ts for the
    // matching guard against that 401 re-triggering this handler).
    void api.logout().catch(() => undefined);
    setAuthToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const result = await api.login({ email, password });
      applySession(result.user, result.token);
    },
    [applySession],
  );

  const signup = useCallback(
    async (email: string, password: string, name: string): Promise<void> => {
      const result = await api.signup({ email, password, name });
      applySession(result.user, result.token);
    },
    [applySession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, signup, logout }),
    [status, user, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

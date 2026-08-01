import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The only animated thing on this page (SignalCollapseDemo) checks this
 * before running its loop. No console page needs this today — the
 * console's own motion is a single 0.4s row-enter lift, small enough that
 * the console has never needed a reduced-motion branch — so this lives
 * here rather than in the shared hooks directory.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

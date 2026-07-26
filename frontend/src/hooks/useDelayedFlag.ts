import { useEffect, useState } from "react";

/**
 * Turns `active` into a flag that only flips true after it has stayed true for
 * `delayMs`. Used to hold back skeletons until a load actually feels slow
 * (≥200ms), so a fast response never flashes a skeleton for a frame — the
 * classic loading-flicker. Resets immediately when `active` goes false.
 */
export function useDelayedFlag(active: boolean, delayMs = 200): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return shown;
}

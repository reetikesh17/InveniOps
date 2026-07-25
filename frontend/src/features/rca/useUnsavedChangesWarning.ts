import { useEffect } from "react";
import { useBlocker, type Blocker } from "react-router-dom";

/**
 * Two-pronged "you have unsaved changes" guard, active only while `when` is true:
 *
 *  - `beforeunload` covers leaving the SPA entirely — tab close, reload, or a
 *    hard navigation to another origin — where React Router never gets a say.
 *  - `useBlocker` covers in-app navigation (a <Link>, a programmatic navigate)
 *    so the operator gets a chance to keep editing rather than silently losing
 *    a long writeup. useBlocker requires a data router — see App.tsx, which is
 *    wired with createBrowserRouter specifically so this works.
 *
 * Returns the Blocker so the caller can render its own confirmation UI when
 * blocker.state === "blocked" (proceed() to leave, reset() to stay).
 */
export function useUnsavedChangesWarning(when: boolean): Blocker {
  const blocker = useBlocker(when);

  useEffect(() => {
    if (!when) {
      return undefined;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Legacy assignment is still required by some browsers to trigger the
      // native prompt; the message itself is ignored by modern ones.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);

  // If the guard turns off (e.g. after a successful submit) while a
  // navigation is parked in the "blocked" state, let it through rather than
  // stranding the user — the reason to block is gone.
  useEffect(() => {
    if (!when && blocker.state === "blocked") {
      blocker.proceed();
    }
  }, [when, blocker]);

  return blocker;
}

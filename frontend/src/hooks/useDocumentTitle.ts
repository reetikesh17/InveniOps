import { useEffect } from "react";

const SUFFIX = "Incident Console";

/**
 * Every route sets its own tab title — an on-call engineer typically has
 * several tabs open at once (the feed, a couple of incidents, analytics) and
 * needs to tell them apart without switching to each. Always suffixed with
 * the brand so a tab is still identifiable as this app at a glance.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} — ${SUFFIX}` : SUFFIX;
  }, [title]);
}

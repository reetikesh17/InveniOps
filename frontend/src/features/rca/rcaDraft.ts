import type { RcaFormValues } from "./rcaValidation";

// Keyed per incident so two incidents' drafts never collide, and sessioned
// (not localStorage) deliberately: a draft is meant to survive an accidental
// navigation or reload within the same working session, not to linger for
// days across browser restarts.
const KEY_PREFIX = "ims:rca-draft:";

function keyFor(incidentId: string): string {
  return `${KEY_PREFIX}${incidentId}`;
}

export function loadDraft(incidentId: string): Partial<RcaFormValues> | null {
  try {
    const raw = sessionStorage.getItem(keyFor(incidentId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed;
  } catch {
    // Corrupt JSON or storage unavailable (private mode/quota) — treat as no draft.
    return null;
  }
}

export function saveDraft(incidentId: string, values: RcaFormValues): void {
  try {
    sessionStorage.setItem(keyFor(incidentId), JSON.stringify(values));
  } catch {
    // Storage unavailable — draft persistence is a nicety, not worth failing the form over.
  }
}

export function clearDraft(incidentId: string): void {
  try {
    sessionStorage.removeItem(keyFor(incidentId));
  } catch {
    // Ignore — nothing we can do, and nothing depends on the removal succeeding.
  }
}

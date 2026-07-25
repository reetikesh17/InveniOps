import { useState } from "react";

// No auth system in this project — transitions and RCA submissions still
// need a real `actor` string for the audit trail (see TransitionTimeline) to
// mean anything, so this persists a freeform "acting as" name across visits
// rather than hardcoding a single dummy value everywhere.
const STORAGE_KEY = "ims:actorName";
const DEFAULT_ACTOR = "operator";

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_ACTOR;
  } catch {
    return DEFAULT_ACTOR;
  }
}

export function useActorName(): readonly [string, (name: string) => void] {
  const [actor, setActorState] = useState<string>(readStored);

  function setActor(name: string): void {
    const trimmed = name.trim() || DEFAULT_ACTOR;
    setActorState(trimmed);
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // Storage may be unavailable (private browsing, quota) — the name still works for this session.
    }
  }

  return [actor, setActor];
}

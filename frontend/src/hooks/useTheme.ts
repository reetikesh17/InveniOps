import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "ims:theme";

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // ignore
  }
  // Dark is the on-call default; fall to light only if the OS asks for it.
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Theme is a first-class control for an on-call tool. Resolves to an explicit
 * data-theme on <html> (stored, else OS preference, else dark), so rendering
 * is deterministic and the CSS token overrides in index.css take effect.
 */
export function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage unavailable — the in-memory theme still applies for this session
    }
  }, [theme]);

  return [theme, () => setTheme((current) => (current === "dark" ? "light" : "dark"))] as const;
}

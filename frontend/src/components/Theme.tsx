"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "rd-theme";

/**
 * Runs before paint, inlined in <head>, so the page never renders in the wrong
 * theme and then snaps. Falls back to the OS preference when nothing is stored.
 */
export const themeBootstrap = `
(function () {
  try {
    var s = localStorage.getItem('${KEY}');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (s === 'dark' || (!s && m)) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );
  }, []);

  function setTheme(t: Theme) {
    const root = document.documentElement;
    // Only animate colours for the toggle itself, not on every route change.
    root.classList.add("theme-transition");
    root.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode: the toggle still works for this session */
    }
    setThemeState(t);
    window.setTimeout(() => root.classList.remove("theme-transition"), 220);
  }

  return [theme, setTheme];
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg
                  border border-line text-muted hover:text-ink hover:border-edge
                  transition-colors ${className}`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round"
         strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  );
}

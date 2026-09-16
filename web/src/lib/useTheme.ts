import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  function setTheme(next: Theme) {
    window.localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  return { theme, setTheme };
}

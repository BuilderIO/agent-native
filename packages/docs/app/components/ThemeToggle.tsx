import { useT } from "@agent-native/core/client";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";
const THEME_CHANGE_EVENT = "docs-theme-change";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export function useDocsTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  const updateTheme = useCallback((next: Theme) => {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);

    const handleThemeChange = () => setTheme(getInitialTheme());
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () =>
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  const toggleTheme = useCallback(() => {
    updateTheme(getInitialTheme() === "light" ? "dark" : "light");
  }, [updateTheme]);

  return { theme, toggleTheme };
}

export default function ThemeToggle() {
  const { theme, toggleTheme } = useDocsTheme();
  const t = useT();

  const label = t("theme.label", { theme: t(`theme.${theme}`) });

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--docs-border)] text-sm text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
    >
      {theme === "light" ? (
        <IconSun size={16} stroke={1.5} />
      ) : (
        <IconMoon size={16} stroke={1.5} />
      )}
    </button>
  );
}

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export const THEME_SETTINGS_SECTION = "settings.preferences.theme";

const THEME_STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const themeListeners = new Set<(next: ThemePreference) => void>();
let syncedMedia: MediaQueryList | null = null;

function ensureSystemMediaSync() {
  if (typeof window === "undefined") return;
  const media = window.matchMedia(DARK_QUERY);
  if (syncedMedia === media) return;
  syncedMedia = media;
  media.addEventListener("change", () => {
    if (readStoredThemePreference() === "system") applyTheme("system");
  });
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function formatThemeCommandLabel(
  choice: ThemePreference,
  systemTheme: "light" | "dark",
): string {
  if (choice === "light") return "Theme: Enable Light theme";
  if (choice === "dark") return "Theme: Enable Dark theme";
  return `Theme: Enable System theme (${systemTheme === "dark" ? "Dark" : "Light"})`;
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(preference);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    readStoredThemePreference,
  );
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    themeListeners.add(setPreferenceState);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setPreferenceState(
        isThemePreference(event.newValue) ? event.newValue : "system",
      );
    };
    window.addEventListener("storage", onStorage);
    return () => {
      themeListeners.delete(setPreferenceState);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => setSystemTheme(media.matches ? "dark" : "light");
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    applyTheme(preference);
  }, [preference, systemTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    for (const listener of themeListeners) listener(next);
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The visible theme still changes for this session.
    }
    if (next === "system") ensureSystemMediaSync();
    applyTheme(next);
  }, []);

  return { preference, setPreference, systemTheme };
}

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "calendar-view-preferences";

export interface ViewPreferences {
  hideWeekends: boolean;
}

const DEFAULT: ViewPreferences = {
  hideWeekends: false,
};

function load(): ViewPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

function save(prefs: ViewPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

const CHANGE_EVENT = "calendar:view-preferences-change";

export function useViewPreferences() {
  const [prefs, setPrefs] = useState<ViewPreferences>(load);

  // Sync across components in the same tab via custom event
  useEffect(() => {
    function handle() {
      setPrefs(load());
    }
    window.addEventListener(CHANGE_EVENT, handle);
    window.addEventListener("storage", handle);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handle);
      window.removeEventListener("storage", handle);
    };
  }, []);

  const update = useCallback((patch: Partial<ViewPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return next;
    });
  }, []);

  return { prefs, update };
}

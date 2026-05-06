import { useState, useCallback, useEffect } from "react";
import { agentNativePath } from "@agent-native/core/client";
import {
  CALENDAR_COLOR_MODE_KEY,
  CALENDAR_SINGLE_COLOR_KEY,
  CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT,
  CALENDAR_VIEW_PREFERENCES_KEY,
  DEFAULT_CALENDAR_VIEW_PREFERENCES,
  calendarViewPreferencesEqual,
  normalizeCalendarViewPreferences,
  type CalendarViewPreferences,
} from "@/lib/calendar-view-preferences";

export type ViewPreferences = CalendarViewPreferences;

function load(): CalendarViewPreferences {
  try {
    const raw = localStorage.getItem(CALENDAR_VIEW_PREFERENCES_KEY);
    const storedPrefs = raw ? JSON.parse(raw) : {};
    const legacyColorMode = localStorage.getItem(CALENDAR_COLOR_MODE_KEY);
    const legacySingleColor = localStorage.getItem(CALENDAR_SINGLE_COLOR_KEY);
    return normalizeCalendarViewPreferences({
      ...storedPrefs,
      colorMode: legacyColorMode ?? storedPrefs.colorMode,
      singleColor: legacySingleColor ?? storedPrefs.singleColor,
    });
  } catch {
    return DEFAULT_CALENDAR_VIEW_PREFERENCES;
  }
}

function save(prefs: CalendarViewPreferences) {
  try {
    localStorage.setItem(CALENDAR_VIEW_PREFERENCES_KEY, JSON.stringify(prefs));
    localStorage.setItem(CALENDAR_COLOR_MODE_KEY, prefs.colorMode);
    localStorage.setItem(CALENDAR_SINGLE_COLOR_KEY, prefs.singleColor);
  } catch {}
}

async function readAppStatePreferences(): Promise<CalendarViewPreferences | null> {
  const res = await fetch(
    agentNativePath(
      `/_agent-native/application-state/${CALENDAR_VIEW_PREFERENCES_KEY}`,
    ),
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status}`);
  return normalizeCalendarViewPreferences(await res.json());
}

function writeAppStatePreferences(prefs: CalendarViewPreferences) {
  fetch(
    agentNativePath(
      `/_agent-native/application-state/${CALENDAR_VIEW_PREFERENCES_KEY}`,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    },
  ).catch(() => {});
}

export function useViewPreferences() {
  const [prefs, setPrefs] = useState<ViewPreferences>(load);

  // Sync across components in the same tab via custom event
  useEffect(() => {
    function handle() {
      setPrefs(load());
    }
    window.addEventListener(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT, handle);
    window.addEventListener("storage", handle);
    return () => {
      window.removeEventListener(
        CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT,
        handle,
      );
      window.removeEventListener("storage", handle);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    async function refresh() {
      try {
        const remote = await readAppStatePreferences();
        if (!cancelled && remote) {
          setPrefs((current) => {
            if (calendarViewPreferencesEqual(current, remote)) return current;
            save(remote);
            window.dispatchEvent(
              new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT),
            );
            return remote;
          });
        }
      } catch {
        // Preferences are a UI convenience; keep the local copy if app-state
        // is temporarily unavailable.
      } finally {
        if (!cancelled) timeout = window.setTimeout(refresh, 2_000);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, []);

  const update = useCallback((patch: Partial<ViewPreferences>) => {
    setPrefs((prev) => {
      const next = normalizeCalendarViewPreferences({ ...prev, ...patch });
      save(next);
      writeAppStatePreferences(next);
      window.dispatchEvent(new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT));
      return next;
    });
  }, []);

  return { prefs, update };
}

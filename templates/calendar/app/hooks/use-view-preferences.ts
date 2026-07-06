import { agentNativePath, callAction } from "@agent-native/core/client";
import { useState, useCallback, useEffect, useRef } from "react";

import {
  CALENDAR_COLOR_MODE_KEY,
  CALENDAR_SINGLE_COLOR_KEY,
  CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT,
  CALENDAR_VIEW_PREFERENCES_KEY,
  DEFAULT_CALENDAR_VIEW_PREFERENCES,
  calendarViewPreferencesEqual,
  normalizeCalendarViewPreferences,
  type CalendarColorMode,
  type CalendarViewPreferences,
} from "@/lib/calendar-view-preferences";

export type ViewPreferences = CalendarViewPreferences;

const PENDING_ACCOUNT_COLORS_KEY = `${CALENDAR_VIEW_PREFERENCES_KEY}:pending-account-colors`;
const PENDING_ACCOUNT_COLORS_TTL_MS = 30_000;

interface PendingAccountColors {
  colors: Record<string, string>;
  colorMode?: CalendarColorMode;
  singleColor?: string;
  expiresAt: number;
}

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

function loadPendingAccountPreferences(): PendingAccountColors | null {
  try {
    const raw = localStorage.getItem(PENDING_ACCOUNT_COLORS_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingAccountColors;
    if (!pending.expiresAt || pending.expiresAt < Date.now()) {
      localStorage.removeItem(PENDING_ACCOUNT_COLORS_KEY);
      return null;
    }
    return pending.colors && typeof pending.colors === "object"
      ? pending
      : null;
  } catch {
    return null;
  }
}

function loadPendingAccountColors(): Record<string, string> {
  return loadPendingAccountPreferences()?.colors ?? {};
}

function savePendingAccountColor(accountEmail: string, accountColor: string) {
  try {
    localStorage.setItem(
      PENDING_ACCOUNT_COLORS_KEY,
      JSON.stringify({
        colors: {
          ...loadPendingAccountColors(),
          [accountEmail]: accountColor,
        },
        colorMode: "single",
        singleColor: accountColor,
        expiresAt: Date.now() + PENDING_ACCOUNT_COLORS_TTL_MS,
      } satisfies PendingAccountColors),
    );
  } catch {}
}

function clearPendingAccountColor(accountEmail: string) {
  try {
    const pending = loadPendingAccountPreferences();
    if (!pending) return;
    const colors = { ...pending.colors };
    const removedColor = colors[accountEmail];
    delete colors[accountEmail];
    if (Object.keys(colors).length === 0) {
      localStorage.removeItem(PENDING_ACCOUNT_COLORS_KEY);
      return;
    }
    localStorage.setItem(
      PENDING_ACCOUNT_COLORS_KEY,
      JSON.stringify({
        colors,
        ...(pending.singleColor && pending.singleColor !== removedColor
          ? { colorMode: pending.colorMode, singleColor: pending.singleColor }
          : {}),
        expiresAt: Date.now() + PENDING_ACCOUNT_COLORS_TTL_MS,
      } satisfies PendingAccountColors),
    );
  } catch {}
}

function clearPendingAccountFallback() {
  try {
    const pending = loadPendingAccountPreferences();
    if (!pending) return;
    if (Object.keys(pending.colors).length === 0) {
      localStorage.removeItem(PENDING_ACCOUNT_COLORS_KEY);
      return;
    }
    localStorage.setItem(
      PENDING_ACCOUNT_COLORS_KEY,
      JSON.stringify({
        colors: pending.colors,
        expiresAt: Date.now() + PENDING_ACCOUNT_COLORS_TTL_MS,
      } satisfies PendingAccountColors),
    );
  } catch {}
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

export function useViewPreferences() {
  const [prefs, setPrefs] = useState<ViewPreferences>(load);
  const accountColorRequestIds = useRef<Record<string, number>>({});
  const pendingAccountColors = useRef<Record<string, string>>({});
  const pendingSingleColor = useRef<string | null>(null);

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
            const pendingPreferences = loadPendingAccountPreferences();
            const pendingColors = {
              ...(pendingPreferences?.colors ?? {}),
              ...pendingAccountColors.current,
            };
            const pendingFallback =
              pendingSingleColor.current ?? pendingPreferences?.singleColor;
            const next =
              Object.keys(pendingColors).length > 0 || pendingFallback
                ? normalizeCalendarViewPreferences({
                    ...remote,
                    ...(pendingFallback
                      ? {
                          colorMode: "single" as const,
                          singleColor: pendingFallback,
                        }
                      : {}),
                    accountColors: {
                      ...remote.accountColors,
                      ...pendingColors,
                    },
                  })
                : remote;

            if (calendarViewPreferencesEqual(current, next)) return current;
            save(next);
            window.dispatchEvent(
              new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT),
            );
            return next;
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
    if ("colorMode" in patch || "singleColor" in patch) {
      pendingSingleColor.current = null;
      clearPendingAccountFallback();
    }
    setPrefs((prev) => {
      const next = normalizeCalendarViewPreferences({ ...prev, ...patch });
      save(next);
      window.dispatchEvent(new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT));
      return next;
    });
    callAction("update-calendar-visual-preferences", patch).catch(() => {});
  }, []);

  const updateAccountColor = useCallback(
    (accountEmail: string, accountColor: string) => {
      const requestId = (accountColorRequestIds.current[accountEmail] ?? 0) + 1;
      accountColorRequestIds.current[accountEmail] = requestId;
      pendingAccountColors.current[accountEmail] = accountColor;
      pendingSingleColor.current = accountColor;
      savePendingAccountColor(accountEmail, accountColor);
      let rollbackPrefs: CalendarViewPreferences | null = null;

      setPrefs((prev) => {
        rollbackPrefs = prev;
        const next = normalizeCalendarViewPreferences({
          ...prev,
          colorMode: "single",
          singleColor: accountColor,
          accountColors: {
            ...prev.accountColors,
            [accountEmail]: accountColor,
          },
        });
        save(next);
        window.dispatchEvent(new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT));
        return next;
      });

      callAction("update-calendar-visual-preferences", {
        accountEmail,
        accountColor,
        singleColor: accountColor,
      })
        .then((result) => {
          if (accountColorRequestIds.current[accountEmail] !== requestId) {
            return;
          }
          delete pendingAccountColors.current[accountEmail];
          if (pendingSingleColor.current === accountColor) {
            pendingSingleColor.current = null;
          }
          clearPendingAccountColor(accountEmail);

          const preferences = (result as { preferences?: unknown }).preferences;
          if (!preferences) return;
          const serverPrefs = normalizeCalendarViewPreferences(preferences);
          setPrefs((current) => {
            const next = normalizeCalendarViewPreferences({
              ...current,
              colorMode:
                current.colorMode === "single" &&
                current.singleColor === accountColor
                  ? serverPrefs.colorMode
                  : current.colorMode,
              singleColor:
                current.singleColor === accountColor ||
                (rollbackPrefs &&
                  current.singleColor === rollbackPrefs.singleColor)
                  ? (serverPrefs.singleColor ?? accountColor)
                  : current.singleColor,
              accountColors: {
                ...current.accountColors,
                [accountEmail]:
                  serverPrefs.accountColors[accountEmail] ?? accountColor,
              },
            });
            if (calendarViewPreferencesEqual(current, next)) return current;
            save(next);
            window.dispatchEvent(
              new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT),
            );
            return next;
          });
        })
        .catch(() => {
          if (accountColorRequestIds.current[accountEmail] === requestId) {
            delete pendingAccountColors.current[accountEmail];
            if (pendingSingleColor.current === accountColor) {
              pendingSingleColor.current = null;
            }
            clearPendingAccountColor(accountEmail);
            setPrefs((current) => {
              if (!rollbackPrefs) return current;
              const accountColors = { ...current.accountColors };
              const previousAccountColor =
                rollbackPrefs.accountColors[accountEmail];
              if (current.accountColors[accountEmail] === accountColor) {
                if (previousAccountColor) {
                  accountColors[accountEmail] = previousAccountColor;
                } else {
                  delete accountColors[accountEmail];
                }
              }
              const next = normalizeCalendarViewPreferences({
                ...current,
                colorMode:
                  current.colorMode === "single" &&
                  current.singleColor === accountColor
                    ? rollbackPrefs.colorMode
                    : current.colorMode,
                singleColor:
                  current.singleColor === accountColor
                    ? rollbackPrefs.singleColor
                    : current.singleColor,
                accountColors,
              });
              if (calendarViewPreferencesEqual(current, next)) return current;
              save(next);
              window.dispatchEvent(
                new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT),
              );
              return next;
            });
          }
        });
    },
    [],
  );

  return { prefs, update, updateAccountColor };
}

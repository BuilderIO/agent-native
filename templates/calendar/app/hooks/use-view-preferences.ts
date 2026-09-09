import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  createContext,
  createElement,
  useState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";

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
import { isSharedCalendarDemo } from "@/lib/shared-calendar-demo";

export type ViewPreferences = CalendarViewPreferences;

interface ViewPreferencesContextValue {
  prefs: ViewPreferences;
  update: (patch: Partial<ViewPreferences>) => void;
  updateAccountColor: (accountEmail: string, accountColor: string) => void;
  updateAccountColorMode: (
    accountEmail: string,
    accountColorMode: CalendarColorMode,
  ) => void;
  updateGoogleCalendarVisibility: (
    preferenceKey: string,
    visible: boolean,
  ) => void;
  updateGoogleCalendarColor: (
    preferenceKey: string,
    color: string | null,
  ) => void;
}

const ViewPreferencesContext =
  createContext<ViewPreferencesContextValue | null>(null);

const PENDING_ACCOUNT_COLORS_KEY = `${CALENDAR_VIEW_PREFERENCES_KEY}:pending-account-colors`;
const PENDING_ACCOUNT_COLORS_TTL_MS = 30_000;

interface PendingAccountColors {
  colors: Record<string, string>;
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
    delete colors[accountEmail];
    if (Object.keys(colors).length === 0) {
      localStorage.removeItem(PENDING_ACCOUNT_COLORS_KEY);
      return;
    }
    localStorage.setItem(
      PENDING_ACCOUNT_COLORS_KEY,
      JSON.stringify({
        colors,
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

const REFRESH_INTERVAL_MS = 2_000;
// Bounds the refresh fetch so a hung request can't stall the self-rescheduling
// setTimeout loop forever.
const REFRESH_ABORT_MS = Math.max(10_000, REFRESH_INTERVAL_MS * 4);

export function shouldApplyPreferencePoll(
  requestedAtRevision: number,
  confirmedRevision: number,
): boolean {
  return requestedAtRevision === confirmedRevision;
}

export function enqueueSourcePreferenceMutation<T>(
  chains: Record<string, Promise<unknown>>,
  preferenceKey: string,
  run: () => Promise<T>,
): Promise<T> {
  const request = (chains[preferenceKey] ?? Promise.resolve()).then(run, run);
  chains[preferenceKey] = request;
  return request;
}

async function readAppStatePreferences(): Promise<CalendarViewPreferences | null> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), REFRESH_ABORT_MS);
  let res: Response;
  try {
    res = await fetch(
      agentNativePath(
        `/_agent-native/application-state/${CALENDAR_VIEW_PREFERENCES_KEY}`,
      ),
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(abortTimer);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status}`);
  return normalizeCalendarViewPreferences(await res.json());
}

function useViewPreferencesState(): ViewPreferencesContextValue {
  const t = useT();
  const demo = isSharedCalendarDemo();
  const [prefs, setPrefs] = useState<ViewPreferences>(load);
  const accountPreferenceRequestIds = useRef<Record<string, number>>({});
  const pendingAccountColors = useRef<Record<string, string>>({});
  const visibilityRequestIds = useRef<Record<string, number>>({});
  const pendingVisibility = useRef<Record<string, boolean>>({});
  const colorRequestIds = useRef<Record<string, number>>({});
  const pendingGoogleColors = useRef<Record<string, string | null>>({});
  const visibilityMutationChains = useRef<Record<string, Promise<unknown>>>({});
  const colorMutationChains = useRef<Record<string, Promise<unknown>>>({});
  const accountMutationChains = useRef<Record<string, Promise<unknown>>>({});
  const confirmedServerRevision = useRef(0);

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
    if (demo) return;
    let cancelled = false;
    let timeout: number | undefined;

    async function refresh() {
      if (document.hidden) {
        if (!cancelled)
          timeout = window.setTimeout(refresh, REFRESH_INTERVAL_MS);
        return;
      }
      try {
        const requestedAtRevision = confirmedServerRevision.current;
        const remote = await readAppStatePreferences();
        if (
          !cancelled &&
          remote &&
          shouldApplyPreferencePoll(
            requestedAtRevision,
            confirmedServerRevision.current,
          )
        ) {
          setPrefs((current) => {
            const pendingPreferences = loadPendingAccountPreferences();
            const pendingColors = {
              ...(pendingPreferences?.colors ?? {}),
              ...pendingAccountColors.current,
            };
            const next = normalizeCalendarViewPreferences({
              ...remote,
              googleCalendarVisibility: {
                ...remote.googleCalendarVisibility,
                ...pendingVisibility.current,
              },
              googleCalendarColors: {
                ...remote.googleCalendarColors,
                ...Object.fromEntries(
                  Object.entries(pendingGoogleColors.current).filter(
                    (entry): entry is [string, string] => entry[1] !== null,
                  ),
                ),
              },
              ...(Object.keys(pendingColors).length > 0
                ? {
                    accountColorModes: {
                      ...remote.accountColorModes,
                      ...Object.fromEntries(
                        Object.keys(pendingColors).map((accountEmail) => [
                          accountEmail,
                          "single" as const,
                        ]),
                      ),
                    },
                    accountColors: {
                      ...remote.accountColors,
                      ...pendingColors,
                    },
                  }
                : {}),
            });

            for (const [key, color] of Object.entries(
              pendingGoogleColors.current,
            )) {
              if (color === null) delete next.googleCalendarColors[key];
            }

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
        if (!cancelled)
          timeout = window.setTimeout(refresh, REFRESH_INTERVAL_MS);
      }
    }

    function handleVisibilityChange() {
      if (!document.hidden && timeout) {
        window.clearTimeout(timeout);
        timeout = undefined;
        void refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void refresh();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [demo]);

  const update = useCallback((patch: Partial<ViewPreferences>) => {
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
      const requestId =
        (accountPreferenceRequestIds.current[accountEmail] ?? 0) + 1;
      accountPreferenceRequestIds.current[accountEmail] = requestId;
      pendingAccountColors.current[accountEmail] = accountColor;
      savePendingAccountColor(accountEmail, accountColor);
      let rollbackPrefs: CalendarViewPreferences | null = null;

      setPrefs((prev) => {
        rollbackPrefs = prev;
        const next = normalizeCalendarViewPreferences({
          ...prev,
          accountColorModes: {
            ...prev.accountColorModes,
            [accountEmail]: "single",
          },
          accountColors: {
            ...prev.accountColors,
            [accountEmail]: accountColor,
          },
        });
        save(next);
        window.dispatchEvent(new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT));
        return next;
      });

      if (demo) return;

      enqueueSourcePreferenceMutation(
        accountMutationChains.current,
        accountEmail,
        () =>
          callAction("update-calendar-visual-preferences", {
            accountEmail,
            accountColor,
          }),
      )
        .then((result) => {
          if (accountPreferenceRequestIds.current[accountEmail] !== requestId) {
            return;
          }
          delete pendingAccountColors.current[accountEmail];
          clearPendingAccountColor(accountEmail);

          const preferences = (result as { preferences?: unknown }).preferences;
          if (!preferences) return;
          const serverPrefs = normalizeCalendarViewPreferences(preferences);
          setPrefs((current) => {
            const next = normalizeCalendarViewPreferences({
              ...current,
              accountColorModes: {
                ...current.accountColorModes,
                [accountEmail]:
                  serverPrefs.accountColorModes[accountEmail] ?? "single",
              },
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
          if (accountPreferenceRequestIds.current[accountEmail] === requestId) {
            delete pendingAccountColors.current[accountEmail];
            clearPendingAccountColor(accountEmail);
            setPrefs((current) => {
              if (!rollbackPrefs) return current;
              const accountColors = { ...current.accountColors };
              const accountColorModes = { ...current.accountColorModes };
              const previousAccountColor =
                rollbackPrefs.accountColors[accountEmail];
              const previousAccountMode =
                rollbackPrefs.accountColorModes[accountEmail];
              if (current.accountColors[accountEmail] === accountColor) {
                if (previousAccountColor) {
                  accountColors[accountEmail] = previousAccountColor;
                } else {
                  delete accountColors[accountEmail];
                }
                if (previousAccountMode) {
                  accountColorModes[accountEmail] = previousAccountMode;
                } else {
                  delete accountColorModes[accountEmail];
                }
              }
              const next = normalizeCalendarViewPreferences({
                ...current,
                accountColorModes,
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
    [demo],
  );

  const updateAccountColorMode = useCallback(
    (accountEmail: string, accountColorMode: CalendarColorMode) => {
      const requestId =
        (accountPreferenceRequestIds.current[accountEmail] ?? 0) + 1;
      accountPreferenceRequestIds.current[accountEmail] = requestId;
      delete pendingAccountColors.current[accountEmail];
      clearPendingAccountColor(accountEmail);
      let rollbackPrefs: CalendarViewPreferences | null = null;

      setPrefs((prev) => {
        rollbackPrefs = prev;
        const next = normalizeCalendarViewPreferences({
          ...prev,
          accountColorModes: {
            ...prev.accountColorModes,
            [accountEmail]: accountColorMode,
          },
        });
        save(next);
        window.dispatchEvent(new Event(CALENDAR_VIEW_PREFERENCES_CHANGE_EVENT));
        return next;
      });

      if (demo) return;

      enqueueSourcePreferenceMutation(
        accountMutationChains.current,
        accountEmail,
        () =>
          callAction("update-calendar-visual-preferences", {
            accountEmail,
            accountColorMode,
          }),
      )
        .then((result) => {
          if (accountPreferenceRequestIds.current[accountEmail] !== requestId) {
            return;
          }
          const preferences = (result as { preferences?: unknown }).preferences;
          if (!preferences) return;
          const serverPrefs = normalizeCalendarViewPreferences(preferences);
          setPrefs((current) => {
            const next = normalizeCalendarViewPreferences({
              ...current,
              accountColorModes: {
                ...current.accountColorModes,
                [accountEmail]:
                  serverPrefs.accountColorModes[accountEmail] ??
                  accountColorMode,
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
          if (accountPreferenceRequestIds.current[accountEmail] === requestId) {
            setPrefs((current) => {
              if (!rollbackPrefs) return current;
              if (
                current.accountColorModes[accountEmail] !== accountColorMode
              ) {
                return current;
              }
              const accountColorModes = { ...current.accountColorModes };
              const previousAccountMode =
                rollbackPrefs.accountColorModes[accountEmail];
              if (previousAccountMode) {
                accountColorModes[accountEmail] = previousAccountMode;
              } else {
                delete accountColorModes[accountEmail];
              }
              const next = normalizeCalendarViewPreferences({
                ...current,
                accountColorModes,
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
    [demo],
  );

  const updateGoogleCalendarVisibility = useCallback(
    (preferenceKey: string, visible: boolean) => {
      const requestId = (visibilityRequestIds.current[preferenceKey] ?? 0) + 1;
      visibilityRequestIds.current[preferenceKey] = requestId;
      pendingVisibility.current[preferenceKey] = visible;
      let rollbackValue: boolean | undefined;
      setPrefs((current) => {
        rollbackValue = current.googleCalendarVisibility[preferenceKey];
        const next = normalizeCalendarViewPreferences({
          ...current,
          googleCalendarVisibility: {
            ...current.googleCalendarVisibility,
            [preferenceKey]: visible,
          },
        });
        save(next);
        return next;
      });

      if (demo) return;

      const request = enqueueSourcePreferenceMutation(
        visibilityMutationChains.current,
        preferenceKey,
        () =>
          callAction("update-calendar-visual-preferences", {
            googleCalendarPreferenceKey: preferenceKey,
            googleCalendarVisible: visible,
          }),
      );
      request
        .then((result) => {
          if (visibilityRequestIds.current[preferenceKey] === requestId) {
            confirmedServerRevision.current += 1;
            delete pendingVisibility.current[preferenceKey];
            const persisted = normalizeCalendarViewPreferences(
              (result as { preferences?: unknown }).preferences as any,
            );
            setPrefs((current) => {
              const next = normalizeCalendarViewPreferences({
                ...current,
                googleCalendarVisibility: {
                  ...current.googleCalendarVisibility,
                  [preferenceKey]:
                    persisted.googleCalendarVisibility[preferenceKey] ??
                    visible,
                },
              });
              save(next);
              return next;
            });
          }
        })
        .catch(() => {
          if (visibilityRequestIds.current[preferenceKey] !== requestId) return;
          delete pendingVisibility.current[preferenceKey];
          setPrefs((current) => {
            if (current.googleCalendarVisibility[preferenceKey] !== visible) {
              return current;
            }
            const googleCalendarVisibility = {
              ...current.googleCalendarVisibility,
            };
            if (rollbackValue === undefined) {
              delete googleCalendarVisibility[preferenceKey];
            } else {
              googleCalendarVisibility[preferenceKey] = rollbackValue;
            }
            const next = normalizeCalendarViewPreferences({
              ...current,
              googleCalendarVisibility,
            });
            save(next);
            return next;
          });
          toast.error(
            `${t("settings.saveFailed")}. ${t("common.tryAgain")}`, // i18n-key-ignore generated calendar catalog
          );
        });
    },
    [demo, t],
  );

  const updateGoogleCalendarColor = useCallback(
    (preferenceKey: string, color: string | null) => {
      const requestId = (colorRequestIds.current[preferenceKey] ?? 0) + 1;
      colorRequestIds.current[preferenceKey] = requestId;
      pendingGoogleColors.current[preferenceKey] = color;
      let rollbackValue: string | undefined;
      setPrefs((current) => {
        rollbackValue = current.googleCalendarColors[preferenceKey];
        const googleCalendarColors = { ...current.googleCalendarColors };
        if (color) googleCalendarColors[preferenceKey] = color;
        else delete googleCalendarColors[preferenceKey];
        const next = normalizeCalendarViewPreferences({
          ...current,
          googleCalendarColors,
        });
        save(next);
        return next;
      });

      if (demo) return;

      const request = enqueueSourcePreferenceMutation(
        colorMutationChains.current,
        preferenceKey,
        () =>
          callAction("update-calendar-visual-preferences", {
            googleCalendarPreferenceKey: preferenceKey,
            googleCalendarColor: color,
          }),
      );
      request
        .then((result) => {
          if (colorRequestIds.current[preferenceKey] === requestId) {
            confirmedServerRevision.current += 1;
            delete pendingGoogleColors.current[preferenceKey];
            const persisted = normalizeCalendarViewPreferences(
              (result as { preferences?: unknown }).preferences as any,
            );
            setPrefs((current) => {
              const googleCalendarColors = {
                ...current.googleCalendarColors,
              };
              const persistedColor =
                persisted.googleCalendarColors[preferenceKey];
              if (persistedColor)
                googleCalendarColors[preferenceKey] = persistedColor;
              else delete googleCalendarColors[preferenceKey];
              const next = normalizeCalendarViewPreferences({
                ...current,
                googleCalendarColors,
              });
              save(next);
              return next;
            });
          }
        })
        .catch(() => {
          if (colorRequestIds.current[preferenceKey] !== requestId) return;
          delete pendingGoogleColors.current[preferenceKey];
          setPrefs((current) => {
            const currentValue = current.googleCalendarColors[preferenceKey];
            if (currentValue !== color && !(color === null && !currentValue)) {
              return current;
            }
            const googleCalendarColors = { ...current.googleCalendarColors };
            if (rollbackValue) {
              googleCalendarColors[preferenceKey] = rollbackValue;
            } else {
              delete googleCalendarColors[preferenceKey];
            }
            const next = normalizeCalendarViewPreferences({
              ...current,
              googleCalendarColors,
            });
            save(next);
            return next;
          });
          toast.error(
            `${t("settings.saveFailed")}. ${t("common.tryAgain")}`, // i18n-key-ignore generated calendar catalog
          );
        });
    },
    [demo, t],
  );

  return {
    prefs,
    update,
    updateAccountColor,
    updateAccountColorMode,
    updateGoogleCalendarVisibility,
    updateGoogleCalendarColor,
  };
}

export function ViewPreferencesProvider({ children }: { children: ReactNode }) {
  const value = useViewPreferencesState();
  return createElement(ViewPreferencesContext.Provider, { value }, children);
}

export function useViewPreferences(): ViewPreferencesContextValue {
  const value = useContext(ViewPreferencesContext);
  if (!value) {
    throw new Error("useViewPreferences requires ViewPreferencesProvider");
  }
  return value;
}

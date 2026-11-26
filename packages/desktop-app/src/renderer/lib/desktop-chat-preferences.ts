import { useSyncExternalStore } from "react";

export const DESKTOP_CHAT_PREFERENCES_STORAGE_KEY =
  "agent-native:desktop-chat-preferences:v1";
export const DESKTOP_CHAT_PREFERENCES_CHANGED_EVENT =
  "agentNative:desktopChatPreferencesChanged";

export interface DesktopChatPreferences {
  resetChatOnAppSwitch: boolean;
}

export const DEFAULT_DESKTOP_CHAT_PREFERENCES: DesktopChatPreferences = {
  resetChatOnAppSwitch: false,
};

let cachedPreferences = readPreferences();
const listeners = new Set<() => void>();

function readPreferences(): DesktopChatPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_DESKTOP_CHAT_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(
      DESKTOP_CHAT_PREFERENCES_STORAGE_KEY,
    );
    if (!raw) return DEFAULT_DESKTOP_CHAT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_DESKTOP_CHAT_PREFERENCES;
    }
    const value = parsed as Record<string, unknown>;
    return {
      resetChatOnAppSwitch:
        typeof value.resetChatOnAppSwitch === "boolean"
          ? value.resetChatOnAppSwitch
          : DEFAULT_DESKTOP_CHAT_PREFERENCES.resetChatOnAppSwitch,
    };
  } catch (error) {
    console.warn("Unable to read desktop chat preferences.", error);
    return DEFAULT_DESKTOP_CHAT_PREFERENCES;
  }
}

function notifyPreferencesChanged(): void {
  cachedPreferences = readPreferences();
  for (const listener of listeners) listener();
}

export function readDesktopChatPreferences(): DesktopChatPreferences {
  return cachedPreferences;
}

export function writeDesktopChatPreferences(
  updates: Partial<DesktopChatPreferences>,
): DesktopChatPreferences {
  const next: DesktopChatPreferences = {
    resetChatOnAppSwitch:
      typeof updates.resetChatOnAppSwitch === "boolean"
        ? updates.resetChatOnAppSwitch
        : cachedPreferences.resetChatOnAppSwitch,
  };
  cachedPreferences = next;
  try {
    window.localStorage.setItem(
      DESKTOP_CHAT_PREFERENCES_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch (error) {
    console.warn(
      "Unable to persist desktop chat preferences; keeping them in memory.",
      error,
    );
  }
  for (const listener of listeners) listener();
  return next;
}

function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DESKTOP_CHAT_PREFERENCES_STORAGE_KEY) {
      notifyPreferencesChanged();
    }
  };
  const handleCustomEvent = () => notifyPreferencesChanged();
  window.addEventListener("storage", handleStorage);
  window.addEventListener(
    DESKTOP_CHAT_PREFERENCES_CHANGED_EVENT,
    handleCustomEvent,
  );
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      DESKTOP_CHAT_PREFERENCES_CHANGED_EVENT,
      handleCustomEvent,
    );
  };
}

export function useDesktopChatPreferences(): DesktopChatPreferences {
  return useSyncExternalStore(
    subscribePreferences,
    readDesktopChatPreferences,
    () => DEFAULT_DESKTOP_CHAT_PREFERENCES,
  );
}

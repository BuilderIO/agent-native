import { useSyncExternalStore } from "react";

export const DESKTOP_TERMINAL_PREFERENCES_STORAGE_KEY =
  "agent-native:desktop-terminal-preferences:v1";
export const DESKTOP_TERMINAL_PREFERENCES_CHANGED_EVENT =
  "agentNative:desktopTerminalPreferencesChanged";

export const DESKTOP_TERMINAL_AGENT_OPTIONS = [
  { id: "claude-code", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "builder.io", label: "Builder.io", command: "builder" },
  { id: "pi", label: "Pi", command: "pi" },
  { id: "opencode", label: "OpenCode", command: "opencode" },
] as const;

export type DesktopTerminalAgentId =
  (typeof DESKTOP_TERMINAL_AGENT_OPTIONS)[number]["id"];

export interface DesktopTerminalPreferences {
  enabled: boolean;
  agent: DesktopTerminalAgentId;
}

export const DEFAULT_DESKTOP_TERMINAL_PREFERENCES: DesktopTerminalPreferences =
  {
    enabled: false,
    agent: "claude-code",
  };

let cachedPreferences = readPreferences();
const listeners = new Set<() => void>();

function isTerminalAgentId(value: unknown): value is DesktopTerminalAgentId {
  return DESKTOP_TERMINAL_AGENT_OPTIONS.some((option) => option.id === value);
}

function readPreferences(): DesktopTerminalPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_DESKTOP_TERMINAL_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(
      DESKTOP_TERMINAL_PREFERENCES_STORAGE_KEY,
    );
    if (!raw) return DEFAULT_DESKTOP_TERMINAL_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_DESKTOP_TERMINAL_PREFERENCES;
    }
    const value = parsed as Record<string, unknown>;
    return {
      enabled:
        typeof value.enabled === "boolean"
          ? value.enabled
          : DEFAULT_DESKTOP_TERMINAL_PREFERENCES.enabled,
      agent: isTerminalAgentId(value.agent)
        ? value.agent
        : DEFAULT_DESKTOP_TERMINAL_PREFERENCES.agent,
    };
  } catch {
    return DEFAULT_DESKTOP_TERMINAL_PREFERENCES;
  }
}

function notifyPreferencesChanged(): void {
  cachedPreferences = readPreferences();
  for (const listener of listeners) listener();
}

export function readDesktopTerminalPreferences(): DesktopTerminalPreferences {
  return cachedPreferences;
}

export function writeDesktopTerminalPreferences(
  updates: Partial<DesktopTerminalPreferences>,
): DesktopTerminalPreferences {
  const next: DesktopTerminalPreferences = {
    ...cachedPreferences,
    ...updates,
    agent: isTerminalAgentId(updates.agent)
      ? updates.agent
      : cachedPreferences.agent,
  };
  cachedPreferences = next;
  try {
    window.localStorage.setItem(
      DESKTOP_TERMINAL_PREFERENCES_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // Renderer preferences remain usable for this session if storage is unavailable.
  }
  for (const listener of listeners) listener();
  return next;
}

function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DESKTOP_TERMINAL_PREFERENCES_STORAGE_KEY) {
      notifyPreferencesChanged();
    }
  };
  const handleCustomEvent = () => notifyPreferencesChanged();
  window.addEventListener("storage", handleStorage);
  window.addEventListener(
    DESKTOP_TERMINAL_PREFERENCES_CHANGED_EVENT,
    handleCustomEvent,
  );
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      DESKTOP_TERMINAL_PREFERENCES_CHANGED_EVENT,
      handleCustomEvent,
    );
  };
}

export function useDesktopTerminalPreferences(): DesktopTerminalPreferences {
  return useSyncExternalStore(
    subscribePreferences,
    readDesktopTerminalPreferences,
    () => DEFAULT_DESKTOP_TERMINAL_PREFERENCES,
  );
}


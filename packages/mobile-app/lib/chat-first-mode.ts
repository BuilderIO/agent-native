import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

// Keep this value aligned with @agent-native/core's browser preference so the
// three clients share one documented preference contract without bundling the
// web storage implementation into React Native. New mobile installs open in
// the same chat-first mode as Electron; an explicit saved false still wins.
export const CHAT_FIRST_MODE_STORAGE_KEY = "agent-native:chat-first-mode:v1";

const listeners = new Set<(enabled: boolean) => void>();

export type ChatFirstModeStorageResult =
  | { ok: true; enabled: boolean }
  | { ok: false; enabled: boolean; reason: string };

export async function loadChatFirstMode(): Promise<ChatFirstModeStorageResult> {
  try {
    const stored = await AsyncStorage.getItem(CHAT_FIRST_MODE_STORAGE_KEY);
    return {
      ok: true,
      enabled: stored === null ? true : stored === "true",
    };
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveChatFirstMode(
  enabled: boolean,
): Promise<ChatFirstModeStorageResult> {
  try {
    await AsyncStorage.setItem(CHAT_FIRST_MODE_STORAGE_KEY, String(enabled));
    for (const listener of listeners) listener(enabled);
    return { ok: true, enabled };
  } catch (error) {
    return {
      ok: false,
      enabled: !enabled,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function subscribeChatFirstMode(
  listener: (enabled: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatFirstMode(): {
  enabled: boolean;
  loaded: boolean;
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<ChatFirstModeStorageResult>;
} {
  const [enabled, setEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadChatFirstMode().then((result) => {
      if (!active) return;
      setEnabledState(result.enabled);
      setLoaded(true);
      setError(result.ok ? null : "Chat-first preference could not be read.");
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(
    () =>
      subscribeChatFirstMode((value) => {
        setEnabledState(value);
        setLoaded(true);
      }),
    [],
  );
  const setEnabled = useCallback(
    async (value: boolean) => {
      const previous = enabled;
      setEnabledState(value);
      setError(null);
      const result = await saveChatFirstMode(value);
      if (!result.ok) {
        setEnabledState(previous);
        setError("Chat-first preference could not be saved on this device.");
      }
      return result;
    },
    [enabled],
  );
  return { enabled, error, loaded, setEnabled };
}

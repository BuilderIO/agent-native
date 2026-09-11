/**
 * `useDevOption` — read/write a dev-overlay option backed by localStorage.
 *
 * Storage layout: `agent-native-dev-overlay-option-<panelId>-<optionId>` holds
 * a JSON-encoded value. Falls back to `defaultValue` when the key is missing
 * or the JSON is corrupt.
 */

import { useCallback, useEffect, useState } from "react";

export const DEV_OVERLAY_STORAGE_PREFIX = "agent-native-dev-overlay-";

export function devOptionKey(panelId: string, optionId: string): string {
  return `${DEV_OVERLAY_STORAGE_PREFIX}option-${panelId}-${optionId}`;
}

function readRaw<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useDevOption<T>(
  panelId: string,
  optionId: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const key = devOptionKey(panelId, optionId);
  const [value, setValue] = useState<T>(() => readRaw(key, defaultValue));

  // Keep tabs (and the overlay's "Clear all" button) in sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key && e.key !== null) return;
      setValue(readRaw(key, defaultValue));
    };
    const onLocal = () => setValue(readRaw(key, defaultValue));
    window.addEventListener("storage", onStorage);
    window.addEventListener("agent-native-dev-overlay:changed", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("agent-native-dev-overlay:changed", onLocal);
    };
  }, [key, defaultValue]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new Event("agent-native-dev-overlay:changed"));
      } catch {
        // localStorage may be disabled — UI state still updates in-memory.
      }
    },
    [key],
  );

  return [value, update];
}

export function clearAllDevOverlayStorage(): void {
  if (typeof window === "undefined") return;
  const toRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(DEV_OVERLAY_STORAGE_PREFIX)) toRemove.push(k);
  }
  for (const k of toRemove) window.localStorage.removeItem(k);
  window.dispatchEvent(new Event("agent-native-dev-overlay:changed"));
}

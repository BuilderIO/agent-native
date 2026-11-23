import { useSyncExternalStore } from "react";

/**
 * Which skin a build with more than one skin shows. A build with one skin
 * never calls this. The choice is per browser and survives a reload.
 */
const STORAGE_KEY = "agent-native.skin";
const CHANGE_EVENT = "agent-native:skin-change";

function read(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function readSkinPreference<Name extends string>(
  names: readonly Name[],
  fallback: Name,
): Name {
  const stored = read();
  return names.includes(stored as Name) ? (stored as Name) : fallback;
}

export function writeSkinPreference(name: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, name);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
  globalThis.dispatchEvent?.(new CustomEvent(CHANGE_EVENT, { detail: name }));
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** The chosen skin, or `fallback` on the server and when nothing valid is stored. */
export function useSkinPreference<Name extends string>(
  names: readonly Name[],
  fallback: Name,
): Name {
  return useSyncExternalStore(
    subscribe,
    () => readSkinPreference(names, fallback),
    () => fallback,
  );
}

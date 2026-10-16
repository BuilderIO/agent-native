import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

/**
 * "Remove camera background" preference. Stored in localStorage (all Clips
 * windows share the tauri://localhost origin) and broadcast as a Tauri
 * event so the bubble and a running recording follow a Settings toggle
 * live.
 */
export const CAMERA_CUTOUT_STORAGE_KEY = "clips:camera-cutout";
export const CAMERA_CUTOUT_EVENT = "clips:camera-cutout-changed";

export function loadCameraCutoutPreference(): boolean {
  try {
    return window.localStorage.getItem(CAMERA_CUTOUT_STORAGE_KEY) === "1";
  } catch (err) {
    // coercion-ok: unreadable storage leaves the cut-out off, its default.
    console.warn("[camera-cutout] could not read the preference", err);
    return false;
  }
}

export function saveCameraCutoutPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(CAMERA_CUTOUT_STORAGE_KEY, enabled ? "1" : "0");
  } catch (err) {
    // The event below still updates open windows.
    console.warn("[camera-cutout] could not store the preference", err);
  }
  emit(CAMERA_CUTOUT_EVENT, { enabled }).catch(() => {
    // Not running inside Tauri (tests, browser preview).
  });
}

/** Calls `onChange` whenever another window (or this one) flips the toggle. */
export function subscribeCameraCutoutPreference(
  onChange: (enabled: boolean) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  const onStorage = (event: StorageEvent) => {
    if (event.key === CAMERA_CUTOUT_STORAGE_KEY) {
      onChange(event.newValue === "1");
    }
  };
  window.addEventListener("storage", onStorage);

  listen<{ enabled?: unknown }>(CAMERA_CUTOUT_EVENT, (event) => {
    if (typeof event.payload?.enabled === "boolean") {
      onChange(event.payload.enabled);
    }
  })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch(() => {
      // Not running inside Tauri; the storage event still covers windows.
    });

  return () => {
    disposed = true;
    window.removeEventListener("storage", onStorage);
    unlisten?.();
  };
}

/** The preference as React state, kept in sync across windows. */
export function useCameraCutoutPreference(): [
  boolean,
  (enabled: boolean) => void,
] {
  const [enabled, setEnabled] = useState(loadCameraCutoutPreference);
  useEffect(() => subscribeCameraCutoutPreference(setEnabled), []);
  const update = useCallback((next: boolean) => {
    setEnabled(next);
    saveCameraCutoutPreference(next);
  }, []);
  return [enabled, update];
}

import { useSyncExternalStore } from "react";

/*
 * Viewer-level wireframe style preference.
 *
 * "sketchy" = rough.js hand-drawn outlines + handwriting font (the default).
 * "clean"   = crisp CSS outlines + normal sans-serif font, no rough.
 *
 * This is a RENDER preference, not plan data — it lives in localStorage and
 * applies to every wireframe the viewer sees, so two people can read the same
 * plan in whichever style they prefer. Backed by useSyncExternalStore with a
 * stable primitive snapshot (no fresh object per read) so it never loops React.
 */

export type WireframeStyle = "sketchy" | "clean";

const STORAGE_KEY = "plan-wireframe-style";
const listeners = new Set<() => void>();

function readStored(): WireframeStyle {
  if (typeof localStorage === "undefined") return "sketchy";
  try {
    return localStorage.getItem(STORAGE_KEY) === "clean" ? "clean" : "sketchy";
  } catch {
    return "sketchy";
  }
}

let current: WireframeStyle = readStored();

export function setWireframeStyle(style: WireframeStyle): void {
  if (style === current) return;
  current = style;
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // ignore (private mode / disabled storage)
  }
  for (const listener of listeners) listener();
}

export function toggleWireframeStyle(): void {
  setWireframeStyle(current === "sketchy" ? "clean" : "sketchy");
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // Cross-tab sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      current = readStored();
      callback();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function getSnapshot(): WireframeStyle {
  return current;
}

function getServerSnapshot(): WireframeStyle {
  return "sketchy";
}

export function useWireframeStyle(): WireframeStyle {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

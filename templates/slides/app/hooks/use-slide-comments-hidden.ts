import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "slides:comments-hidden";
const listeners = new Set<() => void>();
let hidden = readStored();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // coercion-ok: unreadable storage means comments start shown.
    return false;
  }
}

/** Hide or show comment pins and highlights on the editing canvas. */
export function setSlideCommentsHidden(next: boolean): void {
  if (next === hidden) return;
  hidden = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // coercion-ok: a blocked localStorage only forgets the choice on reload.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSlideCommentsHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hidden,
    () => false,
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

/** Shift+C shows or hides comments, as in the View menu. Mount once per editor. */
export function useSlideCommentsHiddenShortcut(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "c" ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        isTextEntry(event.target)
      ) {
        return;
      }
      event.preventDefault();
      setSlideCommentsHidden(!hidden);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

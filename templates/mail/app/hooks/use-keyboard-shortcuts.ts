import { useEffect, useCallback, useRef } from "react";

type ShortcutHandler = (e: KeyboardEvent) => void;

const INTERACTIVE_TARGET_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "summary",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="tab"]',
].join(",");

export function isKeyboardShortcutTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!element) return false;
  return (
    (element instanceof HTMLElement && element.isContentEditable) ||
    element.closest(INTERACTIVE_TARGET_SELECTOR) !== null
  );
}

export function shouldCycleMailTab(target: EventTarget | null): boolean {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!element) return true;

  if (
    element.closest(
      '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]',
    )
  ) {
    return false;
  }
  if (element.closest("[data-mail-tab-list]")) return true;

  return (
    !isKeyboardShortcutTarget(element) &&
    element.closest('[tabindex]:not([tabindex="-1"])') === null
  );
}

export function isMailSearchActive(): boolean {
  const search = document.getElementById(
    "mail-search",
  ) as HTMLInputElement | null;
  return Boolean(search?.value || document.activeElement === search);
}

interface Shortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean | "either";
  alt?: boolean;
  handler: ShortcutHandler;
  shouldHandle?: (e: KeyboardEvent) => boolean;
  skipInInput?: boolean;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      if (e.defaultPrevented) return;

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.skipInInput !== false) {
          if (isKeyboardShortcutTarget(e.target)) continue;
        }

        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const shiftMatch =
          shortcut.shift === "either" || e.shiftKey === Boolean(shortcut.shift);
        const modMatch = shortcut.meta
          ? (e.metaKey || e.ctrlKey) && !e.altKey && shiftMatch
          : !e.metaKey && !e.ctrlKey && !e.altKey && shiftMatch;

        if (keyMatch && modMatch) {
          if (shortcut.shouldHandle && !shortcut.shouldHandle(e)) continue;
          e.preventDefault();
          shortcut.handler(e);
          return;
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export function useSequenceShortcuts(
  sequences: { keys: string[]; handler: () => void }[],
  enabled = true,
) {
  const sequencesRef = useRef(sequences);
  sequencesRef.current = sequences;
  const bufferRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isKeyboardShortcutTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      clearTimeout(timerRef.current);
      bufferRef.current = [...bufferRef.current, e.key.toLowerCase()].slice(-3);

      for (const seq of sequencesRef.current) {
        const buf = bufferRef.current;
        const keys = seq.keys;
        if (buf.length >= keys.length) {
          const tail = buf.slice(buf.length - keys.length);
          if (tail.every((k, i) => k === keys[i])) {
            e.preventDefault();
            seq.handler();
            bufferRef.current = [];
            return;
          }
        }
      }

      timerRef.current = setTimeout(() => {
        bufferRef.current = [];
      }, 1000);
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timerRef.current);
      bufferRef.current = [];
    };
  }, [enabled]);
}

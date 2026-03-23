import { useEffect, useCallback, useRef } from "react";

type ShortcutHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
  /** Skip when an input/textarea is focused */
  skipInInput?: boolean;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.skipInInput !== false) {
          const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
          const isEditable = (e.target as HTMLElement)?.isContentEditable;
          if (tag === "input" || tag === "textarea" || isEditable) continue;
        }

        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const modMatch = shortcut.meta
          ? (e.metaKey || e.ctrlKey) &&
            !e.altKey &&
            (shortcut.shift ? e.shiftKey : !e.shiftKey)
          : !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            (shortcut.shift ? e.shiftKey : !e.shiftKey);

        if (keyMatch && modMatch) {
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

/** Sequence shortcut (e.g. g then i for go-to-inbox) */
export function useSequenceShortcuts(
  sequences: { keys: string[]; handler: () => void }[],
  enabled = true,
) {
  const bufferRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled) return;

    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === "input" || tag === "textarea" || isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      clearTimeout(timerRef.current);
      bufferRef.current = [...bufferRef.current, e.key.toLowerCase()].slice(-3);

      for (const seq of sequences) {
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
    };
  }, [enabled, sequences]);
}

import { useEffect, useRef } from "react";

export type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutBindings = Record<string, ShortcutHandler>;

export interface UseKeyboardShortcutsOptions {
  disableInInputs?: boolean;
  enabled?: boolean;
}

const CHORD_WINDOW_MS = 1000;

export function useKeyboardShortcuts(
  bindings: ShortcutBindings,
  options: UseKeyboardShortcutsOptions = {},
) {
  const { disableInInputs = true, enabled = true } = options;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    let pendingChord: { key: string; at: number } | null = null;

    function normalize(e: KeyboardEvent): string {
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("Cmd");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      const key = keyName(e);
      parts.push(key);
      return parts.join("+");
    }

    function onKey(e: KeyboardEvent) {
      if (disableInInputs && isTypingTarget(e.target)) return;
      const normalized = normalize(e);
      const plainKey = keyName(e);

      if (pendingChord && Date.now() - pendingChord.at <= CHORD_WINDOW_MS) {
        const chordKey = `${pendingChord.key} ${plainKey}`;
        const handler = findBinding(bindingsRef.current, chordKey);
        pendingChord = null;
        if (handler) {
          e.preventDefault();
          handler(e);
          return;
        }
      }

      const handler = findBinding(bindingsRef.current, normalized);
      if (handler) {
        e.preventDefault();
        handler(e);
        return;
      }

      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        hasChordStarting(bindingsRef.current, plainKey)
      ) {
        pendingChord = { key: plainKey, at: Date.now() };
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, disableInInputs]);
}

function keyName(e: KeyboardEvent): string {
  const k = e.key;
  if (k === " ") return "Space";
  if (k === "ArrowLeft") return "ArrowLeft";
  if (k === "ArrowRight") return "ArrowRight";
  if (k === "ArrowUp") return "ArrowUp";
  if (k === "ArrowDown") return "ArrowDown";
  if (k === "Escape") return "Escape";
  if (k === "Enter") return "Enter";
  if (k === "Tab") return "Tab";
  if (k.length === 1) return k.toLowerCase();
  return k;
}

function findBinding(
  bindings: ShortcutBindings,
  key: string,
): ShortcutHandler | undefined {
  if (bindings[key]) return bindings[key];
  const lower = key.toLowerCase();
  for (const [k, h] of Object.entries(bindings)) {
    if (k.toLowerCase() === lower) return h;
  }
  return undefined;
}

function hasChordStarting(bindings: ShortcutBindings, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(bindings).some((k) => {
    const parts = k.split(" ");
    return parts.length === 2 && parts[0].toLowerCase() === lower;
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

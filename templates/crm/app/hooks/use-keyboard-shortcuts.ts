import { useEffect, useRef } from "react";

export interface KeyboardShortcut {
  key: string;
  meta?: boolean;
  shift?: boolean;
  handler: (event: KeyboardEvent) => void;
}

export interface SequenceShortcut {
  keys: string[];
  handler: () => void;
}

export interface ShortcutEventTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

export interface ShortcutKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: ShortcutEventTarget | null;
}

export const SEQUENCE_SHORTCUT_TIMEOUT_MS = 1000;

export function shouldIgnoreShortcutTarget(
  target: ShortcutEventTarget | null | undefined,
): boolean {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.("[contenteditable]"));
}

export function resolveShortcut<T extends KeyboardShortcut>(
  event: ShortcutKeyEvent,
  shortcuts: readonly T[],
): T | null {
  if (shouldIgnoreShortcutTarget(event.target)) return null;
  if (event.altKey) return null;

  const key = event.key.toLowerCase();
  const modified = Boolean(event.metaKey || event.ctrlKey);

  for (const shortcut of shortcuts) {
    if (key !== shortcut.key.toLowerCase()) continue;
    if (Boolean(shortcut.meta) !== modified) continue;
    if (Boolean(shortcut.shift) !== Boolean(event.shiftKey)) continue;
    return shortcut;
  }

  return null;
}

export type SequenceMatch<T extends SequenceShortcut> =
  | { status: "matched"; sequence: T }
  /** The keystroke started or extended a chord; nothing else may claim it. */
  | { status: "pending" }
  /** The keystroke is not part of any chord and is free for a plain binding. */
  | { status: "none" };

export interface SequenceMatcher<T extends SequenceShortcut> {
  push(event: ShortcutKeyEvent, now: number): SequenceMatch<T>;
  reset(): void;
}

function startsWith(keys: readonly string[], prefix: readonly string[]) {
  return prefix.every((key, index) => keys[index] === key);
}

export function createSequenceMatcher<T extends SequenceShortcut>(
  sequences: readonly T[],
  timeoutMs: number = SEQUENCE_SHORTCUT_TIMEOUT_MS,
): SequenceMatcher<T> {
  let buffer: string[] = [];
  let lastKeyAt: number | null = null;

  const clear = () => {
    buffer = [];
    lastKeyAt = null;
  };

  return {
    push(event, now) {
      if (shouldIgnoreShortcutTarget(event.target)) {
        clear();
        return { status: "none" };
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return { status: "none" };
      }

      if (lastKeyAt !== null && now - lastKeyAt > timeoutMs) clear();
      const candidate = [...buffer, event.key.toLowerCase()];

      const matched = sequences.find(
        (sequence) =>
          sequence.keys.length === candidate.length &&
          startsWith(sequence.keys, candidate),
      );
      if (matched) {
        clear();
        return { status: "matched", sequence: matched };
      }

      const pending = sequences.some(
        (sequence) =>
          sequence.keys.length > candidate.length &&
          startsWith(sequence.keys, candidate),
      );
      if (pending) {
        buffer = candidate;
        lastKeyAt = now;
        return { status: "pending" };
      }

      clear();
      return { status: "none" };
    },
    reset: clear,
  };
}

export interface UseShortcutsOptions {
  shortcuts?: readonly KeyboardShortcut[];
  sequences?: readonly SequenceShortcut[];
  enabled?: boolean;
  timeoutMs?: number;
}

export function useKeyboardShortcuts({
  shortcuts = [],
  sequences = [],
  enabled = true,
  timeoutMs = SEQUENCE_SHORTCUT_TIMEOUT_MS,
}: UseShortcutsOptions) {
  const shortcutsRef = useRef(shortcuts);
  const sequencesRef = useRef(sequences);
  shortcutsRef.current = shortcuts;
  sequencesRef.current = sequences;

  const chordSignature = sequences
    .map((sequence) => sequence.keys.join("+"))
    .join("|");

  useEffect(() => {
    if (!enabled) return;

    const matcher = createSequenceMatcher(
      sequencesRef.current.map((sequence, index) => ({
        keys: sequence.keys,
        handler: () => sequencesRef.current[index]?.handler(),
      })),
      timeoutMs,
    );

    const onKeyDown = (event: KeyboardEvent) => {
      const shortcutEvent = event as unknown as ShortcutKeyEvent;
      const chord = matcher.push(shortcutEvent, Date.now());

      if (chord.status === "matched") {
        event.preventDefault();
        chord.sequence.handler();
        return;
      }
      if (chord.status === "pending") {
        event.preventDefault();
        return;
      }

      const shortcut = resolveShortcut(shortcutEvent, shortcutsRef.current);
      if (!shortcut) return;
      event.preventDefault();
      shortcut.handler(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, timeoutMs, chordSignature]);
}

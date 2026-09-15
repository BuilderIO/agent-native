import { useSyncExternalStore } from "react";
import { toast } from "sonner";

type UndoEntry = () => void;

export const UNDO_DURATION = 10_000;

interface ActiveUndo {
  action: UndoEntry;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  toastId?: string | number;
}

let activeUndo: ActiveUndo | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismiss(entry: ActiveUndo) {
  if (entry.toastId !== undefined) toast.dismiss(entry.toastId);
}

function clearEntry(entry: ActiveUndo) {
  clearTimeout(entry.timer);
  dismiss(entry);
  if (activeUndo === entry) {
    activeUndo = undefined;
    notify();
  }
}

function consume(entry: ActiveUndo) {
  if (activeUndo !== entry || Date.now() >= entry.expiresAt) {
    if (activeUndo === entry) clearEntry(entry);
    return;
  }

  clearTimeout(entry.timer);
  activeUndo = undefined;
  dismiss(entry);
  notify();
  entry.action();
}

/** Replace the active undo action and return its consume-once toast callback. */
export function setUndoAction(action: UndoEntry) {
  if (activeUndo) clearEntry(activeUndo);

  const entry = {} as ActiveUndo;
  entry.action = action;
  entry.expiresAt = Date.now() + UNDO_DURATION;
  entry.timer = setTimeout(() => clearEntry(entry), UNDO_DURATION);
  activeUndo = entry;
  notify();

  return () => consume(entry);
}

/** Associate the visible undo toast with the active action for scoped dismissal. */
export function setUndoToastId(toastId: string | number) {
  if (activeUndo) activeUndo.toastId = toastId;
}

/** Clear the active undo operation, if any. */
export function clearUndoAction() {
  if (activeUndo) clearEntry(activeUndo);
}

/** Consume and run the most recent undo action. */
export function runUndo() {
  if (activeUndo) consume(activeUndo);
}

/** React hook — returns true only while an undo action is available. */
export function useHasUndo(): boolean {
  return useSyncExternalStore(subscribe, () => activeUndo !== undefined);
}

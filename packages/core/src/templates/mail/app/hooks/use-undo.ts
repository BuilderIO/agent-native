import { useSyncExternalStore, useCallback } from "react";
import { toast } from "sonner";

type UndoAction = (() => void) | null;

let currentUndo: UndoAction = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UndoAction {
  return currentUndo;
}

/** Register an undo action (e.g. after archiving). */
export function setUndoAction(action: UndoAction) {
  currentUndo = action;
  notify();
}

/** Clear the current undo action. */
export function clearUndoAction() {
  currentUndo = null;
  notify();
}

/** Run the current undo action if one exists, then clear it. */
export function runUndo() {
  if (currentUndo) {
    currentUndo();
    clearUndoAction();
    toast.dismiss();
  }
}

/** React hook — returns true if an undo action is available. */
export function useHasUndo(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot) !== null;
}

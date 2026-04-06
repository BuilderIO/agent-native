import { useSyncExternalStore } from "react";
import { toast } from "sonner";

type UndoEntry = () => void;

const undoStack: UndoEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return undoStack.length;
}

const MAX_UNDO_STACK = 20;

/** Push an undo action onto the stack. */
export function setUndoAction(action: UndoEntry) {
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.splice(0, undoStack.length - MAX_UNDO_STACK);
  }
  notify();
}

/** Clear the entire undo stack. */
export function clearUndoAction() {
  undoStack.length = 0;
  notify();
}

/** Pop and run the most recent undo action. */
export function runUndo() {
  const action = undoStack.pop();
  if (action) {
    action();
    toast.dismiss();
    notify();
  }
}

/** React hook — returns true if any undo actions are available. */
export function useHasUndo(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot) > 0;
}

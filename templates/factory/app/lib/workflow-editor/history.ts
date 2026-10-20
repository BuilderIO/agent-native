import type { WorkflowGraph } from "./engine.js";
import type { Selection } from "./types.js";

export const DEFAULT_HISTORY_LIMIT = 100;

const HISTORY_LABELS = [
  "add-node",
  "delete",
  "duplicate",
  "move",
  "rename",
  "connect",
  "disconnect",
  "back-edge",
  "settings",
  "layout",
  "external",
] as const;
export type HistoryLabel = (typeof HISTORY_LABELS)[number];

export interface Snapshot {
  graph: WorkflowGraph;
  selection: Selection;
}

/**
 * Edits that share a `key` fold into one undo step. A drag or a run of
 * keystrokes passes the same key each time; `windowMs` ends the fold when the
 * author pauses, and is left out when the caller knows where the gesture ends.
 */
export interface Coalesce {
  key: string;
  windowMs?: number;
}

interface Entry {
  label: HistoryLabel;
  before: Snapshot;
  after: Snapshot;
}

interface EditHistory {
  record(
    label: HistoryLabel,
    before: Snapshot,
    after: Snapshot,
    coalesce?: Coalesce,
  ): void;
  /** The snapshot to restore, or undefined when there is nothing to undo. */
  undo(): Snapshot | undefined;
  redo(): Snapshot | undefined;
  /** The next edit starts a new step even if it shares a key with the last. */
  seal(): void;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  nextUndoLabel(): HistoryLabel | undefined;
  nextRedoLabel(): HistoryLabel | undefined;
  size(): number;
}

export function createEditHistory(
  limit: number = DEFAULT_HISTORY_LIMIT,
  now: () => number = Date.now,
): EditHistory {
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  // The fold target is always the top of the undo stack; it is forgotten
  // whenever the stack changes any other way.
  let tail: { key: string; at: number } | null = null;

  return {
    record(label, before, after, coalesce) {
      const at = now();
      const top = undoStack[undoStack.length - 1];
      redoStack.length = 0;
      if (
        coalesce &&
        top &&
        tail &&
        tail.key === coalesce.key &&
        (coalesce.windowMs === undefined || at - tail.at <= coalesce.windowMs)
      ) {
        top.after = after;
        tail = { key: coalesce.key, at };
        return;
      }
      undoStack.push({ label, before, after });
      if (undoStack.length > limit) undoStack.shift();
      tail = coalesce ? { key: coalesce.key, at } : null;
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return undefined;
      redoStack.push(entry);
      tail = null;
      return entry.before;
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return undefined;
      undoStack.push(entry);
      tail = null;
      return entry.after;
    },
    seal() {
      tail = null;
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      tail = null;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    nextUndoLabel: () => undoStack[undoStack.length - 1]?.label,
    nextRedoLabel: () => redoStack[redoStack.length - 1]?.label,
    size: () => undoStack.length,
  };
}

import type { UndoRedoOrderKind } from "../editor-state";
import {
  insertFileCreationHistoryEntry,
  MAX_DESIGN_UNDO_STACK,
  type FileCreationHistoryEntry,
} from "../history";

type MutableRef<T> = { current: T };

export interface PendingFileCreationHistoryEntry {
  designId: string | undefined;
  entry: FileCreationHistoryEntry;
}

interface FileCreationHistoryState {
  designId: string | undefined;
  fileHistoryMutationPendingRef: MutableRef<boolean>;
  pendingFileCreationHistoryEntriesRef: MutableRef<
    PendingFileCreationHistoryEntry[]
  >;
  fileCreationUndoStackRef: MutableRef<FileCreationHistoryEntry[]>;
  historyOrderRef: MutableRef<(UndoRedoOrderKind | "selection")[]>;
  clearRedoStacks: () => void;
  syncUndoRedoState: () => void;
}

function commitFileCreationHistoryEntry(
  state: FileCreationHistoryState,
  entry: FileCreationHistoryEntry,
) {
  const inserted = insertFileCreationHistoryEntry(
    state.fileCreationUndoStackRef.current,
    entry,
  );
  state.fileCreationUndoStackRef.current = inserted.stack;
  if (!inserted.continuesBatch) {
    state.clearRedoStacks();
    state.historyOrderRef.current = [
      ...state.historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-created",
    ];
  }
  state.syncUndoRedoState();
}

export function recordFileCreationHistoryEntry(
  state: FileCreationHistoryState & { entry: FileCreationHistoryEntry },
) {
  if (state.fileHistoryMutationPendingRef.current) {
    state.pendingFileCreationHistoryEntriesRef.current.push({
      designId: state.designId,
      entry: state.entry,
    });
    return;
  }
  commitFileCreationHistoryEntry(state, state.entry);
}

export function flushPendingFileCreationHistoryEntries(
  state: FileCreationHistoryState,
) {
  if (state.fileHistoryMutationPendingRef.current) return;
  const matching = state.pendingFileCreationHistoryEntriesRef.current.filter(
    (item) => item.designId === state.designId,
  );
  state.pendingFileCreationHistoryEntriesRef.current =
    state.pendingFileCreationHistoryEntriesRef.current.filter(
      (item) => item.designId !== state.designId,
    );
  for (const item of matching) {
    commitFileCreationHistoryEntry(state, item.entry);
  }
}

import { describe, expect, it, vi } from "vitest";

import type { FileCreationHistoryEntry } from "../history";
import {
  flushPendingFileCreationHistoryEntries,
  recordFileCreationHistoryEntry,
  type PendingFileCreationHistoryEntry,
} from "./file-creation-history";

const ref = <T>(current: T) => ({ current });

describe("file creation history command", () => {
  it("commits only the settled design's queued entries", () => {
    const first = { filename: "first.html", content: "", fileType: "html" };
    const other = { filename: "other.html", content: "", fileType: "html" };
    const fileHistoryMutationPendingRef = ref(true);
    const pendingFileCreationHistoryEntriesRef = ref<
      PendingFileCreationHistoryEntry[]
    >([]);
    const fileCreationUndoStackRef = ref<FileCreationHistoryEntry[]>([]);
    const historyOrderRef = ref<("file-created" | "selection")[]>([]);
    const clearRedoStacks = vi.fn();
    const syncUndoRedoState = vi.fn();
    const state = {
      fileHistoryMutationPendingRef,
      pendingFileCreationHistoryEntriesRef,
      fileCreationUndoStackRef,
      historyOrderRef,
      clearRedoStacks,
      syncUndoRedoState,
    };

    recordFileCreationHistoryEntry({
      ...state,
      designId: "design-a",
      entry: first,
    });
    recordFileCreationHistoryEntry({
      ...state,
      designId: "design-b",
      entry: other,
    });
    expect(fileCreationUndoStackRef.current).toEqual([]);

    fileHistoryMutationPendingRef.current = false;
    flushPendingFileCreationHistoryEntries({ ...state, designId: "design-a" });
    expect(fileCreationUndoStackRef.current).toEqual([first]);
    expect(pendingFileCreationHistoryEntriesRef.current).toEqual([
      { designId: "design-b", entry: other },
    ]);

    flushPendingFileCreationHistoryEntries({ ...state, designId: "design-b" });
    expect(fileCreationUndoStackRef.current).toEqual([first, other]);
    expect(historyOrderRef.current).toEqual(["file-created", "file-created"]);
    expect(clearRedoStacks).toHaveBeenCalledTimes(2);
    expect(syncUndoRedoState).toHaveBeenCalledTimes(2);
    expect(pendingFileCreationHistoryEntriesRef.current).toEqual([]);
  });
});

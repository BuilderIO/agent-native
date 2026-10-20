import { describe, expect, it } from "vitest";

import { runUndo } from "./commands/undo";
import {
  insertFileCreationHistoryEntry,
  type FileCreationHistoryEntry,
} from "./history";

const ref = <T>(current: T) => ({ current });

describe("file creation history batches", () => {
  it("keeps delayed duplicate completions contiguous behind newer actions", () => {
    const first = {
      filename: "first-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-a",
    };
    const intervening = {
      filename: "other-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-b",
    };
    const delayed = {
      filename: "second-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-a",
    };

    const afterFirst = insertFileCreationHistoryEntry([], first);
    const afterIntervening = insertFileCreationHistoryEntry(
      afterFirst.stack,
      intervening,
    );
    const afterDelayed = insertFileCreationHistoryEntry(
      afterIntervening.stack,
      delayed,
    );

    expect(afterDelayed.continuesBatch).toBe(true);
    expect(afterDelayed.stack).toEqual([first, delayed, intervening]);
  });

  it("preserves redo when a late completion extends an earlier duplicate batch", () => {
    const first = {
      filename: "first-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-a",
    };
    const laterAction = {
      filename: "later-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-b",
    };
    const delayed = {
      filename: "second-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-a",
    };
    const undoStack: FileCreationHistoryEntry[] = [first];
    const redoStack: FileCreationHistoryEntry[] = [laterAction];
    const redoOrder = ["file-created"];
    const insertion = insertFileCreationHistoryEntry(undoStack, delayed);

    if (!insertion.continuesBatch) {
      redoStack.length = 0;
      redoOrder.length = 0;
    }

    expect(insertion.stack).toEqual([first, delayed]);
    expect(redoStack).toEqual([laterAction]);
    expect(redoOrder).toEqual(["file-created"]);
  });

  it("undoes an interleaved multi-screen duplicate in one action", () => {
    const first = {
      filename: "first-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-a",
    };
    const intervening = {
      filename: "other-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-b",
    };
    const delayed = {
      filename: "second-copy.html",
      content: "",
      fileType: "html",
      historyBatchId: "duplicate-a",
    };
    const undoStack: FileCreationHistoryEntry[] = [];
    const historyOrder: string[] = [];
    for (const entry of [first, intervening, delayed]) {
      const inserted = insertFileCreationHistoryEntry(undoStack, entry);
      undoStack.splice(0, undoStack.length, ...inserted.stack);
      if (!inserted.continuesBatch) historyOrder.push("file-created");
    }

    const files = [first, delayed, intervening].map((entry, index) => ({
      ...entry,
      id: `file-${index}`,
    }));
    const deleteCalls: string[][] = [];
    const args = {
      activeEditorDragRef: ref(false),
      activeFile: null,
      canEditDesign: true,
      designDataJsonRef: ref({}),
      fileCreationRedoStackRef: ref([]),
      fileCreationUndoStackRef: ref(undoStack),
      fileHistoryMutationPendingRef: ref(false),
      files,
      historyOrderRef: ref(historyOrder),
      id: "design-1",
      liveFrameGeometryRef: ref({}),
      pendingLiveNonStyleUndoStackRef: ref([]),
      pendingVisualStyleUndoStackRef: ref([]),
      performDeleteFiles: (
        filesToDelete: { filename: string }[],
        options: any,
      ) => {
        deleteCalls.push(filesToDelete.map(({ filename }) => filename));
        options.onMutationSettled(filesToDelete, [], []);
      },
      redoOrderRef: ref([]),
      syncUndoRedoState: () => {},
      t: (key: string) => key,
      undoManagerRef: ref(null),
      viewModeRef: ref("overview"),
      writeFrameGeometrySnapshot: () => {},
    };

    runUndo(args as any);
    runUndo(args as any);

    expect(deleteCalls).toEqual([
      [intervening.filename],
      [first.filename, delayed.filename],
    ]);
  });
});

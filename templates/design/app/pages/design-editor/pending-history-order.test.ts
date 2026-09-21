import { describe, expect, it, vi } from "vitest";

import { runRedo } from "./commands/redo";
import { runUndo } from "./commands/undo";

const ref = <T>(current: T) => ({ current });

describe("pending live history order", () => {
  it("undoes and redoes mixed style and text edits in one strict LIFO order", () => {
    const styleEdit = {
      screenId: "home",
      selector: "#card",
      sourceId: "card",
      styles: { borderRadius: "48px" },
      originalStyles: { borderRadius: "24px" },
      updatedAt: 1,
    };
    const textEdit = {
      kind: "text" as const,
      screenId: "home",
      selector: "#title",
      sourceId: "title",
      value: "Updated",
      originalValue: "Original",
      updatedAt: 2,
    };
    const pendingStyleUndoStackRef = ref([
      { edit: styleEdit, revertStyles: { borderRadius: "24px" } },
    ]);
    const pendingLiveNonStyleUndoStackRef = ref([
      { kind: "text" as const, edit: textEdit, revertValue: "Original" },
    ]);
    const pendingStyleRedoStackRef = ref<any[]>([]);
    const pendingLiveRedoStackRef = ref<any[]>([]);
    const historyOrderRef = ref<any[]>(["pending-style", "pending-live"]);
    const redoOrderRef = ref<any[]>([]);
    const undoArgs = {
      activeEditorDragRef: ref(false),
      activeFile: { id: "home" },
      canEditDesign: true,
      fileHistoryMutationPendingRef: ref(false),
      historyOrderRef,
      pendingLiveNonStyleEditsRef: ref([textEdit]),
      pendingLiveNonStyleRedoStackRef: pendingLiveRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingVisualStyleEditsRef: ref([styleEdit]),
      pendingVisualStyleRedoStackRef: pendingStyleRedoStackRef,
      pendingVisualStyleUndoStackRef: pendingStyleUndoStackRef,
      redoOrderRef,
      requestPendingLiveNonStyleRevert: vi.fn(),
      requestPendingVisualStyleRevert: vi.fn(),
      resetGeometryCommitCoalescing: vi.fn(),
      setPendingLiveNonStyleEdits: vi.fn(),
      setPendingVisualStyleEdits: vi.fn(),
      setSelectedElement: vi.fn(),
      syncUndoRedoState: vi.fn(),
    } as any;

    runUndo(undoArgs);
    expect(undoArgs.requestPendingLiveNonStyleRevert).toHaveBeenCalledTimes(1);
    expect(undoArgs.requestPendingVisualStyleRevert).not.toHaveBeenCalled();
    expect(historyOrderRef.current).toEqual(["pending-style"]);
    expect(redoOrderRef.current).toEqual(["pending-live"]);

    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenCalledTimes(1);
    expect(historyOrderRef.current).toEqual([]);
    expect(redoOrderRef.current).toEqual(["pending-live", "pending-style"]);

    const redoArgs = {
      ...undoArgs,
      setPendingTextRevertRequest: vi.fn(),
      setPendingVisualStyleRevertRequest: vi.fn(),
    } as any;
    runRedo(redoArgs);
    expect(redoArgs.setPendingVisualStyleRevertRequest).toHaveBeenCalledTimes(
      1,
    );
    expect(historyOrderRef.current).toEqual(["pending-style"]);
    expect(redoOrderRef.current).toEqual(["pending-live"]);

    runRedo(redoArgs);
    expect(redoArgs.setPendingTextRevertRequest).toHaveBeenCalledTimes(1);
    expect(historyOrderRef.current).toEqual(["pending-style", "pending-live"]);
    expect(redoOrderRef.current).toEqual([]);
  });
});

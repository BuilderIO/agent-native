import { describe, expect, it, vi } from "vitest";

import { runRecordPendingLiveTextEdit } from "./commands/record-pending-live-text-edit";
import { runRedo } from "./commands/redo";
import { runUndo } from "./commands/undo";

const ref = <T>(current: T) => ({ current });

describe("pending live history order", () => {
  it("does not coalesce text across an interleaved style history entry", () => {
    const historyOrderRef = ref<string[]>([]);
    const pendingLiveNonStyleUndoStackRef = ref<any[]>([]);
    const pendingLiveNonStyleRedoStackRef = ref<any[]>([]);
    const pendingVisualStyleRedoStackRef = ref<any[]>([]);
    const pendingLiveNonStyleEditsRef = ref<any[]>([]);
    const recordPendingHistoryEntry = vi.fn((kind: string) => {
      historyOrderRef.current.push(kind);
    });
    const args = {
      activeFile: { id: "home", filename: "index.html" },
      canEditDesign: true,
      cancelPendingStructureVerification: vi.fn(),
      files: [{ id: "home", filename: "index.html" }],
      localhostConnectionRootPathByIdRef: ref(new Map()),
      overviewScreens: [],
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingStructureRedoReplayRef: ref(undefined),
      pendingStructureRedoReplayTimerRef: ref(undefined),
      pendingVisualStyleRedoStackRef,
      recordPendingHistoryEntry,
      canCoalescePendingLiveEdit: () =>
        historyOrderRef.current[historyOrderRef.current.length - 1] ===
        "pending-live",
      runtimeLayerSnapshotsById: {},
      selectedElement: null,
      setPendingLiveNonStyleEdits: vi.fn(),
    } as any;
    const record = (value: string) =>
      runRecordPendingLiveTextEdit(args, "home", "#title", value, undefined, {
        originalValue: "Original",
      });

    record("Hel");
    record("Help");
    historyOrderRef.current.push("pending-style");
    record("Helper");

    expect(pendingLiveNonStyleUndoStackRef.current).toHaveLength(2);
    expect(
      pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit.value),
    ).toEqual(["Help", "Helper"]);
    expect(recordPendingHistoryEntry).toHaveBeenCalledTimes(2);
    expect(historyOrderRef.current).toEqual([
      "pending-live",
      "pending-style",
      "pending-live",
    ]);
  });

  it("undoes and redoes interleaved style and text edits in strict LIFO order", () => {
    const radius24Edit = {
      screenId: "home",
      filename: "index.html",
      screenName: "Home",
      selector: "#card",
      sourceId: "card",
      classes: [],
      styles: { borderRadius: "24px" },
      originalStyles: { borderRadius: "0px" },
      updatedAt: 1,
    };
    const radius48Edit = {
      ...radius24Edit,
      styles: { borderRadius: "48px" },
      originalStyles: { borderRadius: "24px" },
      updatedAt: 2,
    };
    const fillEdit = {
      screenId: "home",
      filename: "index.html",
      screenName: "Home",
      selector: "#card",
      sourceId: "card",
      classes: [],
      styles: { backgroundColor: "blue" },
      originalStyles: { backgroundColor: "white" },
      updatedAt: 3,
    };
    const textEdit = {
      kind: "text" as const,
      screenId: "home",
      selector: "#title",
      sourceId: "title",
      value: "Updated",
      originalValue: "Original",
      updatedAt: 4,
    };
    const pendingStyleUndoStackRef = ref([
      { edit: radius24Edit, revertStyles: { borderRadius: "0px" } },
      { edit: radius48Edit, revertStyles: { borderRadius: "24px" } },
      { edit: fillEdit, revertStyles: { backgroundColor: "white" } },
    ]);
    const pendingLiveNonStyleUndoStackRef = ref([
      { kind: "text" as const, edit: textEdit, revertValue: "Original" },
    ]);
    const pendingStyleRedoStackRef = ref<any[]>([]);
    const pendingLiveRedoStackRef = ref<any[]>([]);
    const historyOrderRef = ref<any[]>([
      "pending-style",
      "pending-style",
      "pending-style",
      "pending-live",
    ]);
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
      pendingVisualStyleEditsRef: ref([radius24Edit, radius48Edit, fillEdit]),
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
    expect(historyOrderRef.current).toEqual([
      "pending-style",
      "pending-style",
      "pending-style",
    ]);
    expect(redoOrderRef.current).toEqual(["pending-live"]);

    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ styles: { backgroundColor: "blue" } })],
    );
    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ styles: { borderRadius: "48px" } })],
    );
    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenNthCalledWith(
      3,
      [expect.objectContaining({ styles: { borderRadius: "24px" } })],
    );
    expect(historyOrderRef.current).toEqual([]);
    expect(redoOrderRef.current).toEqual([
      "pending-live",
      "pending-style",
      "pending-style",
      "pending-style",
    ]);

    const redoArgs = {
      ...undoArgs,
      setPendingTextRevertRequest: vi.fn(),
      setPendingVisualStyleBaselineResetRequest: vi.fn(),
      setPendingVisualStyleRevertRequest: vi.fn(),
      replayPendingVisualStyleRuntime: vi.fn(),
    } as any;
    runRedo(redoArgs);
    expect(redoArgs.replayPendingVisualStyleRuntime).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ styles: { borderRadius: "24px" } })],
    );

    runRedo(redoArgs);
    expect(redoArgs.replayPendingVisualStyleRuntime).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ styles: { borderRadius: "48px" } })],
    );
    runRedo(redoArgs);
    expect(redoArgs.replayPendingVisualStyleRuntime).toHaveBeenNthCalledWith(
      3,
      [expect.objectContaining({ styles: { backgroundColor: "blue" } })],
    );
    runRedo(redoArgs);
    expect(redoArgs.setPendingTextRevertRequest).toHaveBeenCalledTimes(1);
    expect(historyOrderRef.current).toEqual([
      "pending-style",
      "pending-style",
      "pending-style",
      "pending-live",
    ]);
    expect(redoOrderRef.current).toEqual([]);

    const fallbackBaselineReset = vi.fn();
    redoArgs.replayPendingVisualStyleRuntime = undefined;
    redoArgs.setPendingVisualStyleBaselineResetRequest = fallbackBaselineReset;
    redoArgs.pendingVisualStyleRedoStackRef.current = [
      { edit: radius24Edit, revertStyles: { borderRadius: "0px" } },
    ];
    redoArgs.redoOrderRef.current = ["pending-style"];
    runRedo(redoArgs);
    expect(fallbackBaselineReset).toHaveBeenCalledWith(expect.any(Number));

    const emptyFallbackRevert = vi.fn();
    redoArgs.setPendingVisualStyleRevertRequest = emptyFallbackRevert;
    redoArgs.pendingVisualStyleRedoStackRef.current = [
      { edit: { ...radius24Edit, styles: {} }, revertStyles: {} },
    ];
    redoArgs.redoOrderRef.current = ["pending-style"];
    runRedo(redoArgs);
    expect(emptyFallbackRevert).not.toHaveBeenCalled();
    expect(fallbackBaselineReset).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { runRedo } from "@/pages/design-editor/commands/redo";
import { runUndo } from "@/pages/design-editor/commands/undo";

function sharedRefs() {
  return {
    historyOrderRef: {
      current: ["selection", "file-deleted"] as (
        | "selection"
        | "file-deleted"
      )[],
    },
    redoOrderRef: { current: [] as ("selection" | "file-deleted")[] },
    fileDeletionUndoStackRef: {
      current: [
        {
          files: [
            {
              id: "screen-a",
              filename: "A.html",
              content: "<html></html>",
              fileType: "html",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        },
      ],
    },
    fileDeletionRedoStackRef: { current: [] as any[] },
    selectionUndoStackRef: {
      current: [
        {
          before: {
            overviewSelectedScreenIds: ["screen-a"],
            selectedLayerIds: ["screen-a"],
            activeFileId: "screen-a",
          },
          after: {
            overviewSelectedScreenIds: ["screen-b"],
            selectedLayerIds: ["screen-b"],
            activeFileId: "screen-b",
          },
        },
      ],
    },
    selectionRedoStackRef: { current: [] as any[] },
  };
}

function commonArgs(refs: ReturnType<typeof sharedRefs>) {
  const createFileMutation = {
    mutateAsync: vi.fn().mockResolvedValue({ id: "screen-a-2" }),
  };
  const files = [{ id: "screen-b" }];
  return {
    activeEditorDragRef: { current: false },
    activeFile: { id: "screen-b" },
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate: vi.fn(),
    canEditDesign: true,
    clipboardPasteRedoStackRef: { current: [] },
    clipboardPasteUndoStackRef: { current: [] },
    codeLayerOwnerByNodeIdRef: { current: new Map() },
    contentRedoSelectionStackRef: { current: [] },
    contentRedoStackRef: { current: [] },
    contentUndoSelectionStackRef: { current: [] },
    contentUndoStackRef: { current: [] },
    createFileMutation,
    deleteFileMutation: { mutateAsync: vi.fn() },
    designDataJsonRef: { current: {} },
    fileCreationRedoStackRef: { current: [] },
    fileCreationUndoStackRef: { current: [] },
    fileDeletionRedoStackRef: refs.fileDeletionRedoStackRef,
    fileDeletionUndoStackRef: refs.fileDeletionUndoStackRef,
    fileHistoryMutationPendingRef: { current: false },
    files,
    filesRef: { current: files },
    geometryRedoStackRef: { current: [] },
    geometryUndoStackRef: { current: [] },
    getFreshActiveContent: () => "",
    getScreenContent: () => "",
    historyOrderRef: refs.historyOrderRef,
    id: "design-1",
    isSynced: true,
    lastLocalContentRef: { current: null },
    latestClipboardMutationContentRef: { current: new Map() },
    liveFrameGeometryRef: { current: {} },
    liveScreenSnapshotsById: {},
    localContentRedoStackRef: { current: [] },
    localContentUndoStackRef: { current: [] },
    markPendingLocalFileContent: vi.fn(),
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingLocalFileContentsRef: { current: new Map() },
    pendingVisualStyleEditsRef: { current: [] },
    pendingVisualStyleRedoStackRef: { current: [] },
    pendingVisualStyleUndoStackRef: { current: [] },
    performDeleteFiles: vi.fn(),
    publishAuthoritativeClipboardMutation: vi.fn(),
    queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
    queueFileContentSave: vi.fn(),
    redoOrderRef: refs.redoOrderRef,
    replacePreviewContent: vi.fn(() => "applied"),
    requestPendingLiveNonStyleRevert: vi.fn(),
    requestPendingVisualStyleRevert: vi.fn(),
    restoreSelectionSnapshot: vi.fn(),
    selectionRedoStackRef: refs.selectionRedoStackRef,
    selectionUndoStackRef: refs.selectionUndoStackRef,
    setActiveFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setHoveredElement: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setPendingLiveNonStyleEdits: vi.fn(),
    setPendingVisualStyleEdits: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    suppressContentHistoryRef: { current: false },
    syncLiveScreenSnapshotPreview: vi.fn(),
    syncUndoRedoState: vi.fn(),
    t: (key: string) => key,
    undoManagerRef: { current: null },
    updateLiveScreenSnapshotContent: vi.fn(),
    viewModeRef: { current: "overview" as const },
    writeFrameGeometrySnapshot: vi.fn(),
    ydoc: null,
    contentHistorySelectionAfterRef: { current: new WeakMap() },
    deleteRuntimeElement: vi.fn(() => true),
    focusCreatedScreen: vi.fn(),
    optimisticallyInsertCreatedFile: vi.fn(),
    overviewScreens: [],
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    recordLocalContentHistoryChangeFallback: vi.fn(),
    runtimeStructureInsertRevisionRef: { current: 0 },
    runtimeStructureMoveRevisionRef: { current: 0 },
    setPendingLayerStateReplayRequest: vi.fn(),
    setPendingTextRevertRequest: vi.fn(),
    setPendingVisualStyleRevertRequest: vi.fn(),
    setRuntimeStructureInsertRequest: vi.fn(),
    setRuntimeStructureMoveRequest: vi.fn(),
  };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("undo/redo — selection history after a file-deletion undo", () => {
  it("remaps stale screen ids to the recreated screen instead of restoring a dead one", async () => {
    const refs = sharedRefs();
    const args = commonArgs(refs);

    runUndo(args as unknown as Parameters<typeof runUndo>[0]);
    await flushMicrotasks();

    expect(refs.fileDeletionRedoStackRef.current[0]?.files[0]?.id).toBe(
      "screen-a-2",
    );
    expect(args.optimisticallyInsertCreatedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "screen-a-2",
        filename: "A.html",
        fileType: "html",
      }),
    );
    expect(refs.selectionUndoStackRef.current[0]?.before).toMatchObject({
      overviewSelectedScreenIds: ["screen-a-2"],
      selectedLayerIds: ["screen-a-2"],
      activeFileId: "screen-a-2",
    });
    expect(refs.selectionUndoStackRef.current[0]?.after).toMatchObject({
      overviewSelectedScreenIds: ["screen-b"],
      selectedLayerIds: ["screen-b"],
      activeFileId: "screen-b",
    });

    args.filesRef!.current = [
      ...(args.filesRef!.current as unknown as { id: string }[]),
      { id: "screen-a-2" },
    ];

    runUndo(args as unknown as Parameters<typeof runUndo>[0]);
    await flushMicrotasks();

    expect(args.restoreSelectionSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overviewSelectedScreenIds: ["screen-a-2"],
        selectedLayerIds: ["screen-a-2"],
        activeFileId: "screen-a-2",
      }),
    );

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await flushMicrotasks();

    expect(args.restoreSelectionSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overviewSelectedScreenIds: ["screen-b"],
        selectedLayerIds: ["screen-b"],
        activeFileId: "screen-b",
      }),
    );

    for (const call of args.restoreSelectionSnapshot.mock.calls) {
      const selection = call[0] as {
        overviewSelectedScreenIds: string[];
        selectedLayerIds: string[];
        activeFileId: string | null;
      };
      expect(selection.overviewSelectedScreenIds).not.toContain("screen-a");
      expect(selection.selectedLayerIds).not.toContain("screen-a");
      expect(selection.activeFileId).not.toBe("screen-a");
    }
  });
});

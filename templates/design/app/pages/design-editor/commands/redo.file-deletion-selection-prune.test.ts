import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { runRedo } from "@/pages/design-editor/commands/redo";

/**
 * Redo preserves selection history while the deleted file is dormant in the
 * redo stack. Undoing that deletion can recreate it under a new id and remap
 * these original selection snapshots; pruning them at redo time would lose
 * that history. `preserveHistory` tells the shared delete action to retain the
 * stacks during this replay.
 */
function sharedRefs() {
  return {
    redoOrderRef: {
      current: ["file-deleted"] as ("selection" | "file-deleted")[],
    },
    historyOrderRef: { current: [] as ("selection" | "file-deleted")[] },
    fileDeletionRedoStackRef: {
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
    fileDeletionUndoStackRef: { current: [] as any[] },
    selectionUndoStackRef: {
      current: [
        {
          // Mixed entry remains intact while screen-a is dormant.
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
        {
          // A screen-a-only entry remains available for a later undo restore.
          before: {
            overviewSelectedScreenIds: ["screen-a"],
            selectedLayerIds: [],
            activeFileId: null,
          },
          after: {
            overviewSelectedScreenIds: [],
            selectedLayerIds: [],
            activeFileId: null,
          },
        },
      ],
    },
    selectionRedoStackRef: { current: [] as any[] },
  };
}

function commonArgs(refs: ReturnType<typeof sharedRefs>) {
  return {
    activeEditorDragRef: { current: false },
    activeFile: { id: "screen-b" },
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate: vi.fn(),
    canEditDesign: true,
    clipboardPasteRedoStackRef: { current: [] },
    clipboardPasteUndoStackRef: { current: [] },
    codeLayerOwnerByNodeIdRef: { current: new Map() },
    contentHistorySelectionAfterRef: { current: new WeakMap() },
    contentRedoSelectionStackRef: { current: [] },
    contentRedoStackRef: { current: [] },
    contentUndoSelectionStackRef: { current: [] },
    contentUndoStackRef: { current: [] },
    createFileMutation: { mutateAsync: vi.fn() },
    deleteRuntimeElement: vi.fn(() => true),
    designDataJsonRef: { current: {} },
    fileCreationRedoStackRef: { current: [] },
    fileCreationUndoStackRef: { current: [] },
    fileDeletionRedoStackRef: refs.fileDeletionRedoStackRef,
    fileDeletionUndoStackRef: refs.fileDeletionUndoStackRef,
    fileHistoryMutationPendingRef: { current: false },
    files: [{ id: "screen-b" }],
    focusCreatedScreen: vi.fn(),
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
    optimisticallyInsertCreatedFile: vi.fn(),
    overviewScreens: [],
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingLocalFileContentsRef: { current: new Map() },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingVisualStyleEditsRef: { current: [] },
    pendingVisualStyleRedoStackRef: { current: [] },
    pendingVisualStyleUndoStackRef: { current: [] },
    // Redo re-deletes under the SAME ids it was handed — no renaming, unlike
    // undo's createFileMutation recreate.
    performDeleteFiles: vi.fn((filesToDelete, options) => {
      options?.onMutationSettled?.(filesToDelete, []);
    }),
    publishAuthoritativeClipboardMutation: vi.fn(),
    queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
    queueFileContentSave: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    redoOrderRef: refs.redoOrderRef,
    replacePreviewContent: vi.fn(() => "applied"),
    requestPendingLiveNonStyleRevert: vi.fn(),
    requestPendingVisualStyleRevert: vi.fn(),
    restoreSelectionSnapshot: vi.fn(),
    runtimeStructureInsertRevisionRef: { current: 0 },
    runtimeStructureMoveRevisionRef: { current: 0 },
    selectionRedoStackRef: refs.selectionRedoStackRef,
    selectionUndoStackRef: refs.selectionUndoStackRef,
    setActiveFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setHoveredElement: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setPendingLayerStateReplayRequest: vi.fn(),
    setPendingLiveNonStyleEdits: vi.fn(),
    setPendingTextRevertRequest: vi.fn(),
    setPendingVisualStyleEdits: vi.fn(),
    setPendingVisualStyleRevertRequest: vi.fn(),
    setRuntimeStructureInsertRequest: vi.fn(),
    setRuntimeStructureMoveRequest: vi.fn(),
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
  };
}

describe("redo — selection history after a file-deletion redo", () => {
  it("preserves dormant selection history and requests history-preserving deletion", () => {
    const refs = sharedRefs();
    const originalSelectionHistory = structuredClone(
      refs.selectionUndoStackRef.current,
    );
    const args = commonArgs(refs);

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);

    expect(args.performDeleteFiles).toHaveBeenCalledTimes(1);
    expect(args.performDeleteFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "screen-a" })]),
      expect.objectContaining({ preserveHistory: true }),
    );
    expect(refs.selectionUndoStackRef.current).toEqual(
      originalSelectionHistory,
    );
    expect(
      refs.selectionUndoStackRef.current[0]?.before.selectedLayerIds,
    ).toEqual(["screen-a"]);
    expect(
      refs.selectionUndoStackRef.current[0]?.after.selectedLayerIds,
    ).toEqual(["screen-b"]);
    expect(
      refs.selectionUndoStackRef.current[1]?.before.overviewSelectedScreenIds,
    ).toEqual(["screen-a"]);
  });
});

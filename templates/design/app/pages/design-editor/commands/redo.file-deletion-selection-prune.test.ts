import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { runRedo } from "./redo";

/**
 * Redo's counterpart to undo.file-deletion-selection-remap.test.ts: undoing a
 * deletion recreates the screen under a brand-new id and remaps stale
 * `SelectionHistoryEntry` ids to it (`remapSelectionHistoryStackIds`). Redo
 * re-deletes the same screen under its ORIGINAL id instead — there is no new
 * id to remap to, so a stale entry naming it must be pruned
 * (`pruneSelectionHistoryStackIds`) or a later selection-only undo/redo would
 * restore a selection pointing at a screen that no longer exists.
 *
 * Repro: redo a screen-a deletion while the selection history still carries
 * (1) a mixed entry naming both screen-a and a surviving screen-b, and (2) an
 * entry that only ever named screen-a.
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
          // Mixed entry: screen-a's ids must be stripped, screen-b's kept.
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
          // screen-a-only entry: pruning both sides collapses before/after
          // to the same empty selection, so the whole entry must be dropped.
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
  it("prunes stale screen ids re-deleted under their original id instead of remapping them", () => {
    const refs = sharedRefs();
    const args = commonArgs(refs);

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);

    expect(args.performDeleteFiles).toHaveBeenCalledTimes(1);
    // The mixed entry survives with screen-a stripped and screen-b intact.
    expect(refs.selectionUndoStackRef.current).toEqual([
      {
        before: {
          overviewSelectedScreenIds: [],
          selectedLayerIds: [],
          activeFileId: null,
        },
        after: {
          overviewSelectedScreenIds: ["screen-b"],
          selectedLayerIds: ["screen-b"],
          activeFileId: "screen-b",
        },
      },
    ]);
    // The screen-a-only entry collapsed to a no-op and was dropped entirely.
    expect(refs.selectionUndoStackRef.current).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { runRedo } from "@/pages/design-editor/commands/redo";

const ref = <T>(current: T) => ({ current });

describe("redo file creation metadata persistence", () => {
  it("refetches only after the recreated screen metadata is committed", async () => {
    let resolveUpdate!: () => void;
    const updateDesignAsync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    let onSuccess: ((result: { id: string }) => Promise<void>) | undefined;
    const createFileMutation = {
      mutate: vi.fn(
        (_input: unknown, options: { onSuccess: typeof onSuccess }) => {
          onSuccess = options.onSuccess;
        },
      ),
    };
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    };

    runRedo({
      activeEditorDragRef: ref(false),
      activeFile: { id: "existing-screen" },
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: vi.fn(),
      canEditDesign: true,
      clipboardPasteRedoStackRef: ref([]),
      clipboardPasteUndoStackRef: ref([]),
      codeLayerOwnerByNodeIdRef: ref(new Map()),
      contentHistorySelectionAfterRef: ref(new WeakMap()),
      contentRedoSelectionStackRef: ref([]),
      contentRedoStackRef: ref([]),
      contentUndoSelectionStackRef: ref([]),
      contentUndoStackRef: ref([]),
      createFileMutation,
      deleteRuntimeElement: vi.fn(() => true),
      designDataJsonRef: ref({}),
      fileCreationRedoStackRef: ref([
        {
          filename: "settings.html",
          content: "<main>Settings</main>",
          fileType: "html",
          geometry: { x: 24, y: 32, width: 400, height: 800 },
          screenMetadata: { sourceType: "localhost", width: 400 },
          localhostScreen: { path: "/settings" },
        },
      ]),
      fileCreationUndoStackRef: ref([]),
      fileDeletionRedoStackRef: ref([]),
      fileDeletionUndoStackRef: ref([]),
      fileHistoryMutationPendingRef: ref(false),
      files: [],
      focusCreatedScreen: vi.fn(),
      geometryRedoStackRef: ref([]),
      geometryUndoStackRef: ref([]),
      getFreshActiveContent: () => "",
      getScreenContent: () => "",
      historyOrderRef: ref([]),
      id: "design-1",
      isSynced: true,
      lastLocalContentRef: ref(null),
      liveFrameGeometryRef: ref({}),
      liveScreenSnapshotsById: {},
      localContentRedoStackRef: ref([]),
      localContentUndoStackRef: ref([]),
      markPendingLocalFileContent: vi.fn(),
      optimisticallyInsertCreatedFile: vi.fn(),
      overviewScreens: [],
      pendingLiveNonStyleEditsRef: ref([]),
      pendingLiveNonStyleRedoStackRef: ref([]),
      pendingLiveNonStyleUndoStackRef: ref([]),
      pendingLocalFileContentsRef: ref(new Map()),
      pendingStructureRedoReplayRef: ref(undefined),
      pendingStructureRedoReplayTimerRef: ref(undefined),
      pendingVisualStyleEditsRef: ref([]),
      pendingVisualStyleRedoStackRef: ref([]),
      pendingVisualStyleUndoStackRef: ref([]),
      performDeleteFiles: vi.fn(),
      publishAuthoritativeClipboardMutation: vi.fn(),
      queryClient,
      queueFileContentSave: vi.fn(),
      recordLocalContentHistoryChangeFallback: vi.fn(),
      redoOrderRef: ref(["file-created"]),
      replacePreviewContent: vi.fn(() => "applied"),
      requestPendingLiveNonStyleRevert: vi.fn(),
      requestPendingVisualStyleRevert: vi.fn(),
      restoreSelectionSnapshot: vi.fn(),
      runtimeStructureInsertRevisionRef: ref(0),
      runtimeStructureMoveRevisionRef: ref(0),
      selectionRedoStackRef: ref([]),
      selectionUndoStackRef: ref([]),
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
      suppressContentHistoryRef: ref(false),
      syncLiveScreenSnapshotPreview: vi.fn(),
      syncUndoRedoState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: ref(null),
      updateDesignAsync,
      updateLiveScreenSnapshotContent: vi.fn(),
      viewModeRef: ref("overview"),
      writeFrameGeometrySnapshot: vi.fn(),
      ydoc: null,
    } as any);

    expect(createFileMutation.mutate).toHaveBeenCalledTimes(1);
    const completion = onSuccess?.({ id: "recreated-screen" });
    expect(completion).toBeDefined();
    await Promise.resolve();

    expect(updateDesignAsync).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    resolveUpdate();
    await completion;

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

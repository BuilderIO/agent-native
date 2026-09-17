import { describe, expect, it, vi } from "vitest";

import { runRedo } from "@/pages/design-editor/commands/redo";

const ref = <T>(current: T) => ({ current });

function makeRedoHarness(
  updateDesignAsync: (...args: any[]) => Promise<unknown>,
  performDeleteFiles = vi.fn(),
) {
  let onSuccess:
    | ((result: Record<string, unknown>) => Promise<void>)
    | undefined;
  const createFileMutation = {
    mutate: vi.fn(
      (_input: unknown, options: { onSuccess: typeof onSuccess }) => {
        onSuccess = options.onSuccess;
      },
    ),
  };
  const fileCreationRedoStackRef = ref([
    {
      filename: "settings.html",
      content: "<main>Settings</main>",
      fileType: "html",
      geometry: { x: 24, y: 32, width: 400, height: 800 },
      screenMetadata: { sourceType: "localhost", width: 400 },
      localhostScreen: { path: "/settings" },
    },
  ]);
  const fileCreationUndoStackRef = ref<typeof fileCreationRedoStackRef.current>(
    [],
  );
  const historyOrderRef = ref<string[]>([]);
  const redoOrderRef = ref<string[]>(["file-created"]);
  const fileHistoryMutationPendingRef = ref(false);
  const focusCreatedScreen = vi.fn();
  const optimisticallyInsertCreatedFile = vi.fn();
  const writeFrameGeometrySnapshot = vi.fn();
  const queryClient = {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  };

  const args = {
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
    fileCreationRedoStackRef,
    fileCreationUndoStackRef,
    fileDeletionRedoStackRef: ref([]),
    fileDeletionUndoStackRef: ref([]),
    fileHistoryMutationPendingRef,
    files: [],
    focusCreatedScreen,
    geometryRedoStackRef: ref([]),
    geometryUndoStackRef: ref([]),
    getFreshActiveContent: () => "",
    getScreenContent: () => "",
    historyOrderRef,
    id: "design-1",
    isSynced: true,
    lastLocalContentRef: ref(null),
    liveFrameGeometryRef: ref({}),
    liveScreenSnapshotsById: {},
    localContentRedoStackRef: ref([]),
    localContentUndoStackRef: ref([]),
    markPendingLocalFileContent: vi.fn(),
    optimisticallyInsertCreatedFile,
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
    performDeleteFiles,
    publishAuthoritativeClipboardMutation: vi.fn(),
    queryClient,
    queueFileContentSave: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    redoOrderRef,
    replacePreviewContent: vi.fn(() => "applied"),
    requestPendingLiveNonStyleRevert: vi.fn(),
    requestPendingVisualStyleRevert: vi.fn(),
    restoreSelectionSnapshot: vi.fn(),
    runtimeStructureInsertRevisionRef: ref(0),
    runtimeStructureMoveRevisionRef: ref(0),
    selectionRedoStackRef: ref([]),
    selectionUndoStackRef: ref([]),
    setContentRenderRevision: vi.fn(),
    setHoveredElement: vi.fn(),
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
    writeFrameGeometrySnapshot,
    ydoc: null,
  } as any;

  return {
    args,
    fileCreationRedoStackRef,
    fileCreationUndoStackRef,
    fileHistoryMutationPendingRef,
    focusCreatedScreen,
    getOnSuccess: () => onSuccess,
    historyOrderRef,
    optimisticallyInsertCreatedFile,
    performDeleteFiles,
    queryClient,
    redoOrderRef,
    writeFrameGeometrySnapshot,
  };
}

describe("redo file creation metadata persistence", () => {
  it("refetches only after the recreated screen data is committed", async () => {
    let resolveUpdate!: () => void;
    const updateDesignAsync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const harness = makeRedoHarness(updateDesignAsync);

    runRedo(harness.args);

    expect(harness.args.createFileMutation.mutate).toHaveBeenCalledTimes(1);
    const completion = harness.getOnSuccess()?.({ id: "recreated-screen" });
    expect(completion).toBeDefined();
    await Promise.resolve();

    expect(updateDesignAsync).toHaveBeenCalledTimes(1);
    expect(updateDesignAsync).toHaveBeenCalledWith({
      id: "design-1",
      dataOperations: expect.arrayContaining([
        expect.objectContaining({
          path: ["canvasFrames", "recreated-screen"],
        }),
        expect.objectContaining({
          path: ["screenMetadata", "recreated-screen"],
        }),
        expect.objectContaining({
          path: ["localhostScreens", "recreated-screen"],
        }),
      ]),
    });
    expect(harness.writeFrameGeometrySnapshot).not.toHaveBeenCalled();
    expect(harness.queryClient.invalidateQueries).not.toHaveBeenCalled();

    resolveUpdate();
    await completion;

    expect(harness.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("restores redo and cleans up the file when data persistence fails", async () => {
    const error = new Error("metadata failed");
    const updateDesignAsync = vi.fn().mockRejectedValue(error);
    const performDeleteFiles = vi.fn().mockResolvedValue(undefined);
    const harness = makeRedoHarness(updateDesignAsync, performDeleteFiles);

    runRedo(harness.args);

    const completion = harness.getOnSuccess()?.({
      id: "recreated-screen",
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(completion).toBeDefined();
    await completion;

    expect(performDeleteFiles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "recreated-screen",
          filename: "settings.html",
        }),
      ],
      { preserveHistory: true, skipFileCreationRedoPrune: true },
    );
    expect(harness.optimisticallyInsertCreatedFile).not.toHaveBeenCalled();
    expect(harness.focusCreatedScreen).not.toHaveBeenCalled();
    expect(harness.fileCreationUndoStackRef.current).toEqual([]);
    expect(harness.fileCreationRedoStackRef.current).toHaveLength(1);
    expect(harness.historyOrderRef.current).toEqual([]);
    expect(harness.redoOrderRef.current).toEqual(["file-created"]);
    expect(harness.fileHistoryMutationPendingRef.current).toBe(false);
    expect(harness.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

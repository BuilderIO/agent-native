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
  const deleteFileMutation = {
    mutateAsync: vi.fn().mockResolvedValue({ deleted: true }),
  };
  const queryClient = {
    getQueryData: vi.fn().mockReturnValue(undefined),
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn(),
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
    deleteFileMutation,
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
    deleteFileMutation,
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
  it("replays duplicate z changes without restoring stale frame geometry", async () => {
    const harness = makeRedoHarness(vi.fn().mockResolvedValue(undefined));
    const duplicateEntry = {
      filename: "copy.html",
      content: "<main>copy</main>",
      fileType: "html",
      createdFileId: "old-copy",
      geometry: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      duplicateStack: {
        before: { peer: 1 },
        after: { peer: 2 },
      },
    };
    harness.fileCreationRedoStackRef.current = [duplicateEntry] as any;
    const movedPeer = { x: 1500, y: 420, width: 320, height: 240, z: 1 };
    harness.args.designDataJsonRef.current = {
      canvasFrames: { peer: movedPeer },
    };
    harness.args.liveFrameGeometryRef.current = { peer: movedPeer };

    runRedo(harness.args);
    await vi.waitFor(() => expect(harness.getOnSuccess()).toBeDefined());
    const completion = harness.getOnSuccess()?.({ id: "new-copy" });
    expect(completion).toBeDefined();
    await vi.waitFor(() =>
      expect(harness.writeFrameGeometrySnapshot).toHaveBeenCalled(),
    );

    const dataOperations =
      harness.args.updateDesignAsync.mock.calls[0][0].dataOperations;
    expect(dataOperations).toContainEqual({
      op: "set",
      path: ["canvasFrames", "peer", "z"],
      value: 2,
    });
    expect(dataOperations).not.toContainEqual(
      expect.objectContaining({
        path: ["canvasFrames", "peer"],
      }),
    );
    expect(harness.writeFrameGeometrySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        peer: { ...movedPeer, z: 2 },
        "new-copy": expect.objectContaining({ x: 376, z: 1 }),
      }),
    );
    expect(harness.fileCreationUndoStackRef.current).toContainEqual(
      expect.objectContaining({ createdFileId: "new-copy" }),
    );
    expect(harness.fileCreationUndoStackRef.current[0]).not.toHaveProperty(
      "duplicateStackUndoSettled",
    );
  });

  it("skips duplicate z replay after a concurrent stack reorder", async () => {
    const harness = makeRedoHarness(vi.fn().mockResolvedValue(undefined));
    harness.fileCreationRedoStackRef.current = [
      {
        filename: "copy.html",
        content: "<main>copy</main>",
        fileType: "html",
        createdFileId: "old-copy",
        geometry: { x: 376, y: 0, width: 320, height: 240, z: 1 },
        duplicateStack: {
          before: { peer: 1 },
          after: { peer: 2 },
        },
      },
    ] as any;
    const movedPeer = { x: 1500, y: 420, width: 320, height: 240, z: 9 };
    harness.args.designDataJsonRef.current = {
      canvasFrames: { peer: movedPeer },
    };
    harness.args.liveFrameGeometryRef.current = { peer: movedPeer };

    runRedo(harness.args);
    await vi.waitFor(() => expect(harness.getOnSuccess()).toBeDefined());
    const completion = harness.getOnSuccess()?.({ id: "new-copy" });
    expect(completion).toBeDefined();
    await vi.waitFor(() =>
      expect(harness.writeFrameGeometrySnapshot).toHaveBeenCalled(),
    );

    const dataOperations =
      harness.args.updateDesignAsync.mock.calls[0][0].dataOperations;
    expect(dataOperations).not.toContainEqual(
      expect.objectContaining({ path: ["canvasFrames", "peer", "z"] }),
    );
    expect(harness.writeFrameGeometrySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ peer: movedPeer }),
    );
  });

  it("keeps a canvas move made while duplicate metadata persistence is pending", async () => {
    let settleUpdate!: () => void;
    const updateDesignAsync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleUpdate = resolve;
        }),
    );
    const harness = makeRedoHarness(updateDesignAsync);
    const duplicateEntry = {
      filename: "copy.html",
      content: "<main>copy</main>",
      fileType: "html",
      createdFileId: "old-copy",
      geometry: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      duplicateStack: {
        before: { peer: 1 },
        after: { peer: 2 },
      },
    };
    harness.fileCreationRedoStackRef.current = [duplicateEntry] as any;
    const originalPeer = { x: 1500, y: 420, width: 320, height: 240, z: 1 };
    harness.args.designDataJsonRef.current = {
      canvasFrames: { peer: originalPeer },
    };
    harness.args.liveFrameGeometryRef.current = { peer: originalPeer };

    runRedo(harness.args);
    await vi.waitFor(() => expect(harness.getOnSuccess()).toBeDefined());
    const completion = harness.getOnSuccess()?.({ id: "new-copy" });
    expect(completion).toBeDefined();
    await vi.waitFor(() => expect(updateDesignAsync).toHaveBeenCalledTimes(1));

    const movedPeer = { ...originalPeer, x: 2200, y: 760, z: 2 };
    harness.args.designDataJsonRef.current = {
      canvasFrames: {
        peer: movedPeer,
        "new-copy": duplicateEntry.geometry,
      },
    };
    harness.args.liveFrameGeometryRef.current = { peer: movedPeer };
    settleUpdate();
    await completion;

    expect(harness.writeFrameGeometrySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        peer: movedPeer,
        "new-copy": duplicateEntry.geometry,
      }),
    );
  });

  it("remaps later duplicate stack keys when redo recreates an earlier copy", async () => {
    const harness = makeRedoHarness(vi.fn().mockResolvedValue(undefined));
    harness.redoOrderRef.current = ["file-created", "file-created"];
    const earlier = {
      filename: "earlier.html",
      content: "<main>earlier</main>",
      fileType: "html",
      createdFileId: "old-earlier",
      geometry: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      duplicateStack: { before: { peer: 1 }, after: { peer: 2 } },
    };
    const later = {
      filename: "later.html",
      content: "<main>later</main>",
      fileType: "html",
      createdFileId: "old-later",
      geometry: { x: 752, y: 0, width: 320, height: 240, z: 2 },
      duplicateStack: {
        before: { "old-earlier": 1, peer: 2 },
        after: { "old-earlier": 2, peer: 3 },
      },
    };
    harness.fileCreationRedoStackRef.current = [later, earlier] as any;
    const initialGeometry = {
      source: { x: 0, y: 0, width: 320, height: 240, z: 0 },
      peer: { x: 376, y: 0, width: 320, height: 240, z: 1 },
    };
    harness.args.designDataJsonRef.current = {
      canvasFrames: initialGeometry,
    };
    harness.args.liveFrameGeometryRef.current = initialGeometry;

    runRedo(harness.args);
    await vi.waitFor(() => expect(harness.getOnSuccess()).toBeDefined());
    const firstCompletion = harness.getOnSuccess()?.({ id: "new-earlier" });
    expect(firstCompletion).toBeDefined();
    await firstCompletion;
    await vi.waitFor(() =>
      expect(harness.queryClient.invalidateQueries).toHaveBeenCalledTimes(1),
    );
    await vi.waitFor(() =>
      expect(harness.fileCreationRedoStackRef.current).toHaveLength(1),
    );
    expect(
      (harness.fileCreationRedoStackRef.current[0] as any)?.duplicateStack,
    ).toEqual({
      before: { "new-earlier": 1, peer: 2 },
      after: { "new-earlier": 2, peer: 3 },
    });

    runRedo(harness.args);
    await vi.waitFor(() =>
      expect(harness.args.createFileMutation.mutate).toHaveBeenCalledTimes(2),
    );
    const secondCompletion = harness.getOnSuccess()?.({ id: "new-later" });
    expect(secondCompletion).toBeDefined();
    await secondCompletion;
    await vi.waitFor(() =>
      expect(harness.queryClient.invalidateQueries).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(harness.focusCreatedScreen).toHaveBeenCalledTimes(2),
    );

    expect(harness.writeFrameGeometrySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        "new-earlier": { x: 376, y: 0, width: 320, height: 240, z: 2 },
        peer: { x: 376, y: 0, width: 320, height: 240, z: 3 },
        "new-later": expect.objectContaining({ x: 752, z: 2 }),
      }),
    );
  });

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
    await vi.waitFor(() =>
      expect(harness.args.createFileMutation.mutate).toHaveBeenCalledTimes(1),
    );

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
    await vi.waitFor(() =>
      expect(harness.queryClient.invalidateQueries).toHaveBeenCalledTimes(1),
    );
  });

  it("restores redo and cleans up the file when data persistence fails", async () => {
    const error = new Error("metadata failed");
    const updateDesignAsync = vi.fn().mockRejectedValue(error);
    const performDeleteFiles = vi.fn().mockResolvedValue(undefined);
    const harness = makeRedoHarness(updateDesignAsync, performDeleteFiles);

    runRedo(harness.args);
    await vi.waitFor(() => expect(harness.getOnSuccess()).toBeDefined());

    const completion = harness.getOnSuccess()?.({
      id: "recreated-screen",
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(completion).toBeDefined();
    await vi.waitFor(() =>
      expect(harness.deleteFileMutation.mutateAsync).toHaveBeenCalledWith({
        id: "recreated-screen",
        allowLockedLayers: true,
      }),
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

import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { runRedo } from "@/pages/design-editor/commands/redo";

function sharedRefs() {
  return {
    redoOrderRef: {
      current: ["file-deleted"] as (
        | "selection"
        | "file-deleted"
        | "file-created"
      )[],
    },
    historyOrderRef: {
      current: [] as ("selection" | "file-deleted" | "file-created")[],
    },
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
    deleteFileMutation: { mutateAsync: vi.fn() },
    deleteRuntimeElement: vi.fn(() => true),
    designDataJsonRef: { current: {} },
    fileCreationRedoStackRef: { current: [] as any[] },
    fileCreationUndoStackRef: { current: [] as any[] },
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
    performDeleteFiles: vi.fn((filesToDelete, options) => {
      options?.onMutationSettled?.(filesToDelete, [], filesToDelete);
    }),
    publishAuthoritativeClipboardMutation: vi.fn(),
    queryClient: {
      getQueryData: vi.fn().mockReturnValue(undefined),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    },
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
    updateDesignAsync: vi.fn(),
    viewModeRef: { current: "overview" as const },
    writeFrameGeometrySnapshot: vi.fn(),
    ydoc: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("builds the next undo entry from the delete action snapshot", () => {
    const refs = sharedRefs();
    const authoritativeSnapshot = {
      ...refs.fileDeletionRedoStackRef.current[0]!.files[0],
      content: "<html>edited after undo</html>",
      updatedAt: "2024-02-01T00:00:00Z",
      geometry: { x: 90, y: 40, width: 640, height: 480, z: 3 },
      screenMetadata: { title: "Edited after undo" },
      variantMemberships: [
        {
          setId: "set-1",
          set: { screens: ["screen-a"] },
          screen: "screen-a",
          index: 0,
          originalScreenIds: ["screen-a"],
        },
      ],
    };
    const args = commonArgs(refs);
    args.performDeleteFiles = vi.fn((filesToDelete, options) => {
      options?.onMutationSettled?.(filesToDelete, [], [authoritativeSnapshot]);
    });

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);

    expect(refs.fileDeletionUndoStackRef.current).toEqual([
      { files: [authoritativeSnapshot] },
    ]);
  });

  it("cleans up a partial create before retrying file-creation redo", async () => {
    const refs = sharedRefs();
    let activeFileId: string | undefined;
    let sequence = 0;
    const createFileMutation = {
      mutateAsync: vi.fn().mockImplementation(async () => {
        if (activeFileId) throw new Error("filename collision");
        sequence += 1;
        activeFileId = `copy-${sequence}`;
        return { id: activeFileId };
      }),
    };
    const deleteFileMutation = {
      mutateAsync: vi.fn().mockImplementation(async ({ id }) => {
        expect(id).toBe("copy-1");
        activeFileId = undefined;
        return { id, deleted: true };
      }),
    };
    const updateDesignAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error("metadata failed"))
      .mockResolvedValueOnce({});
    refs.redoOrderRef.current = ["file-created"];
    refs.historyOrderRef.current = [];
    const args = commonArgs(refs);
    args.createFileMutation = createFileMutation;
    args.deleteFileMutation = deleteFileMutation;
    args.updateDesignAsync = updateDesignAsync;
    args.fileCreationRedoStackRef.current = [
      {
        filename: "index-copy.html",
        content: "<html></html>",
        fileType: "html",
        geometry: { x: 100, y: 100, width: 640, height: 480 },
        screenMetadata: { sourceType: "inline" },
      },
    ];

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await vi.waitFor(() =>
      expect(deleteFileMutation.mutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(args.fileCreationRedoStackRef.current).toHaveLength(1);

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-2",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    expect(createFileMutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("metadata failed");
  });

  it("fails loudly when file-creation redo returns no id", async () => {
    const refs = sharedRefs();
    refs.redoOrderRef.current = ["file-created"];
    refs.historyOrderRef.current = [];
    const args = commonArgs(refs);
    args.createFileMutation = {
      mutateAsync: vi.fn().mockResolvedValue({}),
    };
    args.fileCreationRedoStackRef.current = [
      {
        filename: "index-copy.html",
        content: "<html></html>",
        fileType: "html",
      },
    ];

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("create-file returned no id"),
      ),
    );

    expect(args.fileCreationRedoStackRef.current).toHaveLength(1);
    expect(args.fileCreationRedoStackRef.current[0]?.recoveryFileId).toBe(null);
    expect(args.fileCreationUndoStackRef.current).toHaveLength(0);
    expect(args.optimisticallyInsertCreatedFile).not.toHaveBeenCalled();
    expect(args.focusCreatedScreen).not.toHaveBeenCalled();
  });

  it("reuses a redo survivor when cleanup fails", async () => {
    const refs = sharedRefs();
    let rowPresent = false;
    const deleteFileMutation = {
      mutateAsync: vi.fn().mockRejectedValue(new Error("cleanup failed")),
    };
    const updateDesignAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error("metadata failed"))
      .mockResolvedValueOnce({});
    refs.redoOrderRef.current = ["file-created"];
    const args = commonArgs(refs);
    args.createFileMutation = {
      mutateAsync: vi.fn().mockImplementation(async () => {
        rowPresent = true;
        return { id: "copy-1" };
      }),
    };
    args.deleteFileMutation = deleteFileMutation;
    args.updateDesignAsync = updateDesignAsync;
    args.queryClient = {
      getQueryData: vi.fn(() =>
        rowPresent
          ? {
              files: [
                {
                  id: "copy-1",
                  filename: "index-copy.html",
                  fileType: "html",
                  content: "<html></html>",
                },
              ],
            }
          : { files: [] },
      ),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    };
    args.fileCreationRedoStackRef.current = [
      {
        filename: "index-copy.html",
        content: "<html></html>",
        fileType: "html",
        geometry: { x: 100, y: 100, width: 640, height: 480 },
        screenMetadata: { sourceType: "inline" },
      },
    ];

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await vi.waitFor(() =>
      expect(deleteFileMutation.mutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(args.fileCreationRedoStackRef.current[0]?.recoveryFileId).toBe(
      "copy-1",
    );

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-1",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    expect(args.createFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(args.fileCreationUndoStackRef.current[0]?.recoveryFileId).toBe(
      undefined,
    );
  });

  it("reconciles a committed create response without an id", async () => {
    const refs = sharedRefs();
    refs.redoOrderRef.current = ["file-created"];
    let cached: unknown;
    const persistedFile = {
      id: "copy-1",
      filename: "index-copy.html",
      fileType: "html",
      content: "<html></html>",
    };
    const args = commonArgs(refs);
    args.createFileMutation = {
      mutateAsync: vi.fn().mockImplementation(async () => {
        cached = { files: [persistedFile] };
        return {};
      }),
    };
    args.queryClient = {
      getQueryData: vi.fn(() => cached),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    };
    args.fileCreationRedoStackRef.current = [
      {
        filename: "index-copy.html",
        content: "<html></html>",
        fileType: "html",
      },
    ];

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-1",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    expect(args.createFileMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("restores the full selection after redoing a multi-screen create batch", async () => {
    const refs = sharedRefs();
    refs.redoOrderRef.current = ["file-created"];
    const args = commonArgs(refs);
    args.createFileMutation = {
      mutateAsync: vi
        .fn()
        .mockResolvedValueOnce({ id: "copy-a" })
        .mockResolvedValueOnce({ id: "copy-b" }),
    };
    args.fileCreationRedoStackRef.current = [
      {
        filename: "index-copy.html",
        content: "<html></html>",
        fileType: "html",
        historyBatchId: "duplicate-1",
        geometry: { x: 100, y: 100, width: 640, height: 480 },
      },
      {
        filename: "index-copy-2.html",
        content: "<html></html>",
        fileType: "html",
        historyBatchId: "duplicate-1",
        geometry: { x: 900, y: 100, width: 640, height: 480 },
      },
    ];

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledTimes(2),
    );
    expect(args.setOverviewSelectedScreenIds).toHaveBeenCalledWith([
      "copy-a",
      "copy-b",
    ]);
  });

  it("keeps a redo ledger entry when the design id is unavailable", () => {
    const refs = sharedRefs();
    refs.redoOrderRef.current = ["file-created"];
    const args = commonArgs(refs);
    args.id = undefined as any;
    args.fileCreationRedoStackRef.current = [
      {
        filename: "index-copy.html",
        content: "<html></html>",
        fileType: "html",
      },
    ];

    runRedo(args as unknown as Parameters<typeof runRedo>[0]);

    expect(args.fileCreationRedoStackRef.current).toHaveLength(1);
    expect(args.redoOrderRef.current).toEqual(["file-created"]);
    expect(args.createFileMutation.mutateAsync).not.toHaveBeenCalled();
  });
});

import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentLineage } from "@/lib/clipboard-content-lineage";
import { cloneCanvasFrameGeometry } from "@/pages/design-editor/design-data-geometry-utils";
import type { UndoRedoOrderKind } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  FileCreationHistoryEntry,
  FileDeletionHistoryEntry,
  FileDeletionHistorySnapshot,
  GeometryHistoryEntry,
  GeometryHistorySelection,
} from "@/pages/design-editor/history";
import {
  MAX_DESIGN_UNDO_STACK,
  filterFileDeletionHistoryEntry,
  getContentHistoryChanges,
  pruneFileCreationHistoryStack,
  pruneGeometryHistoryEntryForDeletedFiles,
  removeRecentUndoRedoOrderKinds,
} from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

export interface DeleteFilesArgs {
  activeFile: DesignFile;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  clearRedoStacks: () => void;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
  clipboardPasteUndoStackRef: RefObject<ContentHistoryChange[]>;
  contentRedoSelectionStackRef: RefObject<
    (GeometryHistorySelection | undefined)[]
  >;
  contentRedoStackRef: RefObject<ContentHistoryEntry[]>;
  contentUndoSelectionStackRef: RefObject<
    (GeometryHistorySelection | undefined)[]
  >;
  contentUndoStackRef: RefObject<ContentHistoryEntry[]>;
  deleteFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "delete-file">
  >;
  fileCreationRedoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileCreationUndoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileDeletionUndoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileHistoryMutationPendingRef: RefObject<boolean>;
  clearPendingHistory?: () => void;
  files: DesignFile[];
  geometryRedoStackRef: RefObject<GeometryHistoryEntry[]>;
  geometryUndoStackRef: RefObject<GeometryHistoryEntry[]>;
  historyOrderRef: RefObject<UndoRedoOrderKind[]>;
  id: string | undefined;
  latestClipboardMutationContentRef: RefObject<
    Map<string, ClipboardContentLineage>
  >;
  localContentRedoStackRef: RefObject<ContentHistoryChange[]>;
  localContentUndoStackRef: RefObject<ContentHistoryChange[]>;
  queryClient: QueryClient;
  redoOrderRef: RefObject<UndoRedoOrderKind[]>;
  overviewSelectedScreenIds?: string[];
  selectedElement?: ElementInfo | null;
  selectedLayerIdsState?: string[];
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setOverviewSelectedScreenIds?: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  syncUndoRedoState: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export async function runDeleteFiles(
  {
    activeFile,
    canvasFrameGeometryById,
    clearRedoStacks,
    designDataJsonRef,
    clipboardPasteRedoStackRef,
    clipboardPasteUndoStackRef,
    contentRedoSelectionStackRef,
    contentRedoStackRef,
    contentUndoSelectionStackRef,
    contentUndoStackRef,
    deleteFileMutation,
    fileCreationRedoStackRef,
    fileCreationUndoStackRef,
    fileDeletionUndoStackRef,
    fileHistoryMutationPendingRef,
    clearPendingHistory,
    files,
    geometryRedoStackRef,
    geometryUndoStackRef,
    historyOrderRef,
    id,
    latestClipboardMutationContentRef,
    localContentRedoStackRef,
    localContentUndoStackRef,
    queryClient,
    redoOrderRef,
    overviewSelectedScreenIds,
    selectedElement,
    selectedLayerIdsState,
    setActiveFileId,
    setOverviewSelectedScreenIds,
    setSelectedElement,
    setSelectedLayerIdsState,
    syncUndoRedoState,
    t,
    writeFrameGeometrySnapshot,
  }: DeleteFilesArgs,
  filesToDelete: DesignFile[],
  options?: {
    skipFileCreationRedoPrune?: boolean;
    recordDeletionHistory?: boolean;
    preserveHistory?: boolean;
    onMutationSettled?: (
      deletedFiles: DesignFile[],
      failedFiles: DesignFile[],
      deletedFileSnapshots: FileDeletionHistorySnapshot[],
    ) => void;
  },
): Promise<void> {
  if (!filesToDelete.length) return;
  if (options?.recordDeletionHistory && fileHistoryMutationPendingRef.current) {
    throw new Error(t("common.genericError"));
  }
  const deleteIds = new Set(filesToDelete.map((file) => file.id));
  const nextActiveFile = files.find((file) => !deleteIds.has(file.id));
  const previousGeometry = cloneCanvasFrameGeometry(canvasFrameGeometryById);
  const previousSelection = {
    overviewSelectedScreenIds: [...(overviewSelectedScreenIds ?? [])],
    selectedElement: selectedElement ?? null,
    selectedLayerIds: [...(selectedLayerIdsState ?? [])],
  };
  const nextGeometry = cloneCanvasFrameGeometry(canvasFrameGeometryById);
  const designQueryKey = ["action", "get-design", { id }] as const;
  const previousDesignQuery = queryClient.getQueryData?.(designQueryKey);
  const recordDeletionHistory = options?.recordDeletionHistory === true;
  if (recordDeletionHistory) {
    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
  }
  filesToDelete.forEach((file) => {
    delete nextGeometry[file.id];
  });

  const pruneHistoryForDeletedFiles = (filesToPrune: DesignFile[]) => {
    const deletedFileIds = new Set(filesToPrune.map((file) => file.id));
    const nextGeometryUndoStack: GeometryHistoryEntry[] = [];
    let removedGeometryUndoEntries = 0;
    geometryUndoStackRef.current.forEach((entry) => {
      const pruned = pruneGeometryHistoryEntryForDeletedFiles(
        entry,
        deletedFileIds,
      );
      if (!pruned) {
        removedGeometryUndoEntries += 1;
        return;
      }
      nextGeometryUndoStack.push(pruned);
    });
    geometryUndoStackRef.current = nextGeometryUndoStack;
    historyOrderRef.current = removeRecentUndoRedoOrderKinds(
      historyOrderRef.current,
      "geometry",
      removedGeometryUndoEntries,
    );

    const nextGeometryRedoStack: GeometryHistoryEntry[] = [];
    let removedGeometryRedoEntries = 0;
    geometryRedoStackRef.current.forEach((entry) => {
      const pruned = pruneGeometryHistoryEntryForDeletedFiles(
        entry,
        deletedFileIds,
      );
      if (!pruned) {
        removedGeometryRedoEntries += 1;
        return;
      }
      nextGeometryRedoStack.push(pruned);
    });
    geometryRedoStackRef.current = nextGeometryRedoStack;
    redoOrderRef.current = removeRecentUndoRedoOrderKinds(
      redoOrderRef.current,
      "geometry",
      removedGeometryRedoEntries,
    );

    const nextContentUndoStack: ContentHistoryEntry[] = [];
    const nextContentUndoSelectionStack: (
      | GeometryHistorySelection
      | undefined
    )[] = [];
    let removedContentUndoEntries = 0;
    contentUndoStackRef.current.forEach((entry, index) => {
      const remainingChanges = getContentHistoryChanges(entry).filter(
        (change) => !deletedFileIds.has(change.fileId),
      );
      if (remainingChanges.length === 0) {
        removedContentUndoEntries += 1;
        return;
      }
      nextContentUndoStack.push(
        remainingChanges.length === 1
          ? remainingChanges[0]
          : { changes: remainingChanges },
      );
      nextContentUndoSelectionStack.push(
        contentUndoSelectionStackRef.current[index],
      );
    });
    contentUndoStackRef.current = nextContentUndoStack;
    contentUndoSelectionStackRef.current = nextContentUndoSelectionStack;
    historyOrderRef.current = removeRecentUndoRedoOrderKinds(
      historyOrderRef.current,
      "file-content",
      removedContentUndoEntries,
    );
    const nextContentRedoStack: ContentHistoryEntry[] = [];
    const nextContentRedoSelectionStack: (
      | GeometryHistorySelection
      | undefined
    )[] = [];
    let removedContentRedoEntries = 0;
    contentRedoStackRef.current.forEach((entry, index) => {
      const remainingChanges = getContentHistoryChanges(entry).filter(
        (change) => !deletedFileIds.has(change.fileId),
      );
      if (remainingChanges.length === 0) {
        removedContentRedoEntries += 1;
        return;
      }
      nextContentRedoStack.push(
        remainingChanges.length === 1
          ? remainingChanges[0]
          : { changes: remainingChanges },
      );
      nextContentRedoSelectionStack.push(
        contentRedoSelectionStackRef.current[index],
      );
    });
    contentRedoStackRef.current = nextContentRedoStack;
    contentRedoSelectionStackRef.current = nextContentRedoSelectionStack;
    redoOrderRef.current = removeRecentUndoRedoOrderKinds(
      redoOrderRef.current,
      "file-content",
      removedContentRedoEntries,
    );
    localContentUndoStackRef.current = localContentUndoStackRef.current.filter(
      (change) => !deletedFileIds.has(change.fileId),
    );
    localContentRedoStackRef.current = localContentRedoStackRef.current.filter(
      (change) => !deletedFileIds.has(change.fileId),
    );

    const deletedFilenames = new Set(filesToPrune.map((file) => file.filename));
    const prunedFileCreationUndo = pruneFileCreationHistoryStack(
      fileCreationUndoStackRef.current,
      deletedFilenames,
    );
    fileCreationUndoStackRef.current = prunedFileCreationUndo.stack;
    historyOrderRef.current = removeRecentUndoRedoOrderKinds(
      historyOrderRef.current,
      "file-created",
      prunedFileCreationUndo.removed,
    );
    const prunedFileCreationRedo = pruneFileCreationHistoryStack(
      fileCreationRedoStackRef.current,
      deletedFilenames,
      { skip: options?.skipFileCreationRedoPrune },
    );
    fileCreationRedoStackRef.current = prunedFileCreationRedo.stack;
    redoOrderRef.current = removeRecentUndoRedoOrderKinds(
      redoOrderRef.current,
      "file-created",
      prunedFileCreationRedo.removed,
    );
  };

  writeFrameGeometrySnapshot(nextGeometry);
  queryClient.setQueryData(designQueryKey, (old: any) => {
    if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
      return old;
    }
    return {
      ...old,
      files: old.files.filter((file: DesignFile) => !deleteIds.has(file.id)),
    };
  });

  if (activeFile && deleteIds.has(activeFile.id) && nextActiveFile) {
    setActiveFileId(nextActiveFile.id);
  }
  setOverviewSelectedScreenIds?.([]);
  setSelectedElement(null);
  setSelectedLayerIdsState([]);

  const results = await Promise.allSettled([
    deleteFileMutation.mutateAsync({
      id: filesToDelete[0]!.id,
      ...(filesToDelete.length > 1
        ? { fileIds: filesToDelete.map((file) => file.id) }
        : {}),
      allowLockedLayers: true,
    } as any),
  ]);
  const mutationResult = results[0];
  const mutationValue =
    mutationResult?.status === "fulfilled"
      ? (mutationResult.value as
          | {
              deleted?: boolean;
              deletedIds?: string[];
              id?: string;
              deletedFiles?: FileDeletionHistorySnapshot[];
            }
          | undefined)
      : undefined;
  const deletedIdsFromServer = new Set(
    Array.isArray(mutationValue?.deletedIds)
      ? mutationValue.deletedIds
      : mutationValue?.deleted && mutationValue.id
        ? [mutationValue.id]
        : mutationValue?.deleted && filesToDelete.length === 1
          ? [filesToDelete[0]!.id]
          : [],
  );
  const deletedFiles = filesToDelete.filter((file) =>
    deletedIdsFromServer.has(file.id),
  );
  const deletedIds = new Set(deletedFiles.map((file) => file.id));
  const failedFiles = filesToDelete.filter((file) => !deletedIds.has(file.id));
  if (
    !recordDeletionHistory &&
    !options?.preserveHistory &&
    deletedFiles.length
  ) {
    pruneHistoryForDeletedFiles(deletedFiles);
  }
  const serverDeletedFileSnapshots = Array.isArray(mutationValue?.deletedFiles)
    ? mutationValue.deletedFiles
    : [];
  const hasCompleteHistorySnapshot =
    serverDeletedFileSnapshots.length === deletedFiles.length &&
    new Set(serverDeletedFileSnapshots.map((file) => file.id)).size ===
      deletedFiles.length &&
    deletedFiles.every((file) =>
      serverDeletedFileSnapshots.some((snapshot) => snapshot.id === file.id),
    );
  const deletionHistoryEntry: FileDeletionHistoryEntry | null =
    recordDeletionHistory &&
    deletedFiles.length > 0 &&
    hasCompleteHistorySnapshot
      ? { files: serverDeletedFileSnapshots }
      : null;

  if (recordDeletionHistory && deletedFiles.length > 0) {
    clearRedoStacks();
    if (deletionHistoryEntry) {
      fileDeletionUndoStackRef.current = [
        ...fileDeletionUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        filterFileDeletionHistoryEntry(deletionHistoryEntry, deletedIds),
      ];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-deleted",
      ];
    } else {
      clearPendingHistory?.();
      toast.error(t("common.genericError"));
    }
  }

  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedFiles.length > 0) {
    writeFrameGeometrySnapshot(previousGeometry);
    if (previousDesignQuery !== undefined) {
      queryClient.setQueryData(designQueryKey, previousDesignQuery);
    }
    if (activeFile && deleteIds.has(activeFile.id)) {
      setActiveFileId(activeFile.id);
    }
    setOverviewSelectedScreenIds?.(previousSelection.overviewSelectedScreenIds);
    setSelectedElement(previousSelection.selectedElement);
    setSelectedLayerIdsState(previousSelection.selectedLayerIds);
    void queryClient.invalidateQueries({
      queryKey: ["action", "get-design"],
    });
    if (rejected) {
      toast.error(
        rejected.reason instanceof Error
          ? rejected.reason.message
          : t("common.genericError"),
      );
    }
    if (recordDeletionHistory) clearPendingHistory?.();
  }

  if (recordDeletionHistory) {
    fileHistoryMutationPendingRef.current = false;
    for (const fileId of deletedIds)
      latestClipboardMutationContentRef.current.delete(fileId);
  }
  options?.onMutationSettled?.(
    deletedFiles,
    failedFiles,
    serverDeletedFileSnapshots,
  );
  syncUndoRedoState();

  syncUndoRedoState();
}

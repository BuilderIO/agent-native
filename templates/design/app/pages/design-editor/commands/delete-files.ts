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
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  syncUndoRedoState: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export function runDeleteFiles(
  {
    activeFile,
    canvasFrameGeometryById,
    clearRedoStacks,
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
    setActiveFileId,
    setSelectedElement,
    setSelectedLayerIdsState,
    syncUndoRedoState,
    t,
    writeFrameGeometrySnapshot,
  }: DeleteFilesArgs,
  filesToDelete: DesignFile[],
  options?: {
    // U12 fix: undoFileCreation pushes the just-undone create onto the
    // file-creation REDO stack, then calls this function to soft-delete
    // the same file it just pushed for. Without this flag the filename-
    // keyed prune below (which exists to drop a redo entry when its file
    // is hard-deleted directly, NOT via undo) would immediately remove
    // the entry undoFileCreation just pushed, leaving redo permanently
    // empty after every screen-create/duplicate undo.
    skipFileCreationRedoPrune?: boolean;
    // A user-confirmed screen deletion is a normal editor operation, not
    // an irreversible special case. Capture the complete rows + frame
    // geometry and add one grouped undo entry after every delete succeeds.
    recordDeletionHistory?: boolean;
    onMutationSettled?: (
      deletedFiles: DesignFile[],
      failedFiles: DesignFile[],
    ) => void;
  },
) {
  if (!filesToDelete.length) return;
  const deleteIds = new Set(filesToDelete.map((file) => file.id));
  const nextActiveFile = files.find((file) => !deleteIds.has(file.id));
  const nextGeometry = cloneCanvasFrameGeometry(canvasFrameGeometryById);
  const deletionHistoryEntry: FileDeletionHistoryEntry | null =
    options?.recordDeletionHistory
      ? {
          files: filesToDelete.map((file) => ({
            ...file,
            geometry: canvasFrameGeometryById[file.id],
          })),
        }
      : null;
  if (deletionHistoryEntry) {
    clearRedoStacks();
    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
  }
  filesToDelete.forEach((file) => {
    delete nextGeometry[file.id];
  });

  const nextGeometryUndoStack: GeometryHistoryEntry[] = [];
  let removedGeometryUndoEntries = 0;
  geometryUndoStackRef.current.forEach((entry) => {
    const pruned = pruneGeometryHistoryEntryForDeletedFiles(entry, deleteIds);
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
    const pruned = pruneGeometryHistoryEntryForDeletedFiles(entry, deleteIds);
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

  // Selection-restore stacks are index-aligned with their matching
  // content stack (see contentUndoSelectionStackRef's doc comment) —
  // iterate with the index so a dropped entry (remainingChanges.length
  // === 0) drops its selection snapshot too, keeping both arrays in sync.
  const nextContentUndoStack: ContentHistoryEntry[] = [];
  const nextContentUndoSelectionStack: (
    | GeometryHistorySelection
    | undefined
  )[] = [];
  let removedContentUndoEntries = 0;
  contentUndoStackRef.current.forEach((entry, index) => {
    const remainingChanges = getContentHistoryChanges(entry).filter(
      (change) => !deleteIds.has(change.fileId),
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
      (change) => !deleteIds.has(change.fileId),
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
    (change) => !deleteIds.has(change.fileId),
  );
  localContentRedoStackRef.current = localContentRedoStackRef.current.filter(
    (change) => !deleteIds.has(change.fileId),
  );

  // U12: a file-created entry is resolved by filename at undo/redo time
  // (it doesn't carry an id, since the id isn't known until the create
  // mutation resolves), so prune it here by filename when the file it
  // refers to is being hard-deleted directly.
  const deletedFilenames = new Set(filesToDelete.map((file) => file.filename));
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
  // U12 fix: undoFileCreation calls performDeleteFiles to soft-delete the
  // file it is undoing AFTER pushing that same entry onto the redo stack
  // (so redo can recreate it). Pruning the redo stack by filename here
  // would immediately drop the entry undoFileCreation just pushed —
  // redo would never survive an undo. skipFileCreationRedoPrune lets
  // that caller opt out; every other caller (direct hard-delete from the
  // overview/panel) still gets the filename-keyed prune so a redo entry
  // pointing at a since-hard-deleted file cannot resurrect it.
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

  writeFrameGeometrySnapshot(nextGeometry);
  queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
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
  setSelectedElement(null);
  setSelectedLayerIdsState([]);

  void Promise.allSettled(
    filesToDelete.map((file) =>
      deleteFileMutation.mutateAsync({ id: file.id } as any),
    ),
  ).then((results) => {
    const deletedFiles = filesToDelete.filter((_, index) => {
      const result = results[index];
      return (
        result?.status === "fulfilled" &&
        (result.value as { deleted?: boolean } | undefined)?.deleted !== false
      );
    });
    const deletedIds = new Set(deletedFiles.map((file) => file.id));
    const failedFiles = filesToDelete.filter(
      (file) => !deletedIds.has(file.id),
    );

    if (deletionHistoryEntry && deletedFiles.length > 0) {
      fileDeletionUndoStackRef.current = [
        ...fileDeletionUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        filterFileDeletionHistoryEntry(deletionHistoryEntry, deletedIds),
      ];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-deleted",
      ];
    }

    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failedFiles.length > 0) {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-design"],
      });
      if (rejected) {
        toast.error(
          rejected.reason instanceof Error
            ? rejected.reason.message
            : t("common.genericError"),
        );
      }
    }

    if (deletionHistoryEntry) {
      fileHistoryMutationPendingRef.current = false;
      clipboardPasteUndoStackRef.current = [];
      clipboardPasteRedoStackRef.current = [];
      latestClipboardMutationContentRef.current.clear();
    }
    options?.onMutationSettled?.(deletedFiles, failedFiles);
    syncUndoRedoState();
  });

  // File-backed screen deletion is not a geometry-only edit. The screen rows
  // are hard-deleted, so suppress MultiScreenCanvas' local frame-history
  // entry; otherwise undo would restore geometry for files that no longer
  // exist.
  syncUndoRedoState();
}

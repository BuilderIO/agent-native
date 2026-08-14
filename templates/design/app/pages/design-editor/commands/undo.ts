import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type {
  ClipboardContentLineage,
  ClipboardContentMutationOrigin,
  ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import {
  refreshElementInfoFromContent,
  refreshSelectedLayerIdsFromContent,
} from "@/pages/design-editor/code-layer-state";
import type { LiveScreenSnapshot } from "@/pages/design-editor/command-types";
import {
  getCanvasFrameGeometry,
  staleGeometryFrameIds,
  viewportChangedFrameIds,
} from "@/pages/design-editor/design-data-geometry-utils";
import type {
  PreviewContentReplaceResult,
  UndoRedoOrderKind,
} from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
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
  applyGeometryHistoryDiff,
  findLastContentHistoryChangeIndex,
  getAvailableContentHistoryChanges,
  remapFileDeletionHistoryEntryIds,
} from "@/pages/design-editor/history";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveNonStyleUndoEntry,
  PendingVisualStyleEdit,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  mergePendingLiveNonStyleEdits,
  mergePendingVisualStyleEdits,
} from "@/pages/design-editor/pending-edits";
import { pendingEditTargetsSelectedElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface UndoArgs {
  activeEditorDragRef: RefObject<boolean>;
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
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
  createFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >;
  deleteFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "delete-file">
  >;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  fileCreationRedoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileCreationUndoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileDeletionRedoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileDeletionUndoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileHistoryMutationPendingRef: RefObject<boolean>;
  files: DesignFile[];
  geometryRedoStackRef: RefObject<GeometryHistoryEntry[]>;
  geometryUndoStackRef: RefObject<GeometryHistoryEntry[]>;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  historyOrderRef: RefObject<UndoRedoOrderKind[]>;
  id: string | undefined;
  isSynced: boolean;
  lastLocalContentRef: RefObject<string | null>;
  latestClipboardMutationContentRef: RefObject<
    Map<string, ClipboardContentLineage>
  >;
  liveFrameGeometryRef: RefObject<CanvasFrameGeometryById>;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  localContentRedoStackRef: RefObject<ContentHistoryChange[]>;
  localContentUndoStackRef: RefObject<ContentHistoryChange[]>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
  ) => void;
  pendingLiveNonStyleEditsRef: RefObject<PendingLiveNonStyleEdit[]>;
  pendingLiveNonStyleRedoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLiveNonStyleUndoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  pendingVisualStyleEditsRef: RefObject<PendingVisualStyleEdit[]>;
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  pendingVisualStyleUndoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  performDeleteFiles: (
    filesToDelete: DesignFile[],
    options?: {
      skipFileCreationRedoPrune?: boolean;
      recordDeletionHistory?: boolean;
      onMutationSettled?: (
        deletedFiles: DesignFile[],
        failedFiles: DesignFile[],
      ) => void;
    },
  ) => void;
  publishAuthoritativeClipboardMutation: (args: {
    fileId: string;
    baseContent: string;
    nextContent: string;
    origin: ClipboardContentMutationOrigin;
  }) => ClipboardContentMutationPublication | null;
  queryClient: QueryClient;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options?: { syncCollab?: boolean; immediate?: boolean },
  ) => void;
  redoOrderRef: RefObject<UndoRedoOrderKind[]>;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  requestPendingLiveNonStyleRevert: (
    edits: readonly PendingLiveNonStyleEdit[],
  ) => void;
  requestPendingVisualStyleRevert: (
    edits: readonly PendingVisualStyleEdit[],
  ) => void;
  restoreSelectionSnapshot: (
    selection: GeometryHistorySelection | undefined,
  ) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
  setPendingVisualStyleEdits: Dispatch<
    SetStateAction<PendingVisualStyleEdit[]>
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  suppressContentHistoryRef: RefObject<boolean>;
  syncLiveScreenSnapshotPreview: (screenId: string, html: string) => void;
  syncUndoRedoState: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  viewModeRef: RefObject<"single" | "overview">;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
  ydoc: Y.Doc | null;
}

export function runUndo({
  activeEditorDragRef,
  activeFile,
  applyFileContentUpdate,
  applyLocalContentUpdate,
  canEditDesign,
  clipboardPasteRedoStackRef,
  clipboardPasteUndoStackRef,
  contentRedoSelectionStackRef,
  contentRedoStackRef,
  contentUndoSelectionStackRef,
  contentUndoStackRef,
  createFileMutation,
  deleteFileMutation,
  designDataJsonRef,
  fileCreationRedoStackRef,
  fileCreationUndoStackRef,
  fileDeletionRedoStackRef,
  fileDeletionUndoStackRef,
  fileHistoryMutationPendingRef,
  files,
  geometryRedoStackRef,
  geometryUndoStackRef,
  getFreshActiveContent,
  getScreenContent,
  historyOrderRef,
  id,
  isSynced,
  lastLocalContentRef,
  latestClipboardMutationContentRef,
  liveFrameGeometryRef,
  liveScreenSnapshotsById,
  localContentRedoStackRef,
  localContentUndoStackRef,
  markPendingLocalFileContent,
  pendingLiveNonStyleEditsRef,
  pendingLiveNonStyleRedoStackRef,
  pendingLiveNonStyleUndoStackRef,
  pendingLocalFileContentsRef,
  pendingVisualStyleEditsRef,
  pendingVisualStyleRedoStackRef,
  pendingVisualStyleUndoStackRef,
  performDeleteFiles,
  publishAuthoritativeClipboardMutation,
  queryClient,
  queueFileContentSave,
  redoOrderRef,
  replacePreviewContent,
  requestPendingLiveNonStyleRevert,
  requestPendingVisualStyleRevert,
  restoreSelectionSnapshot,
  setActiveFileId,
  setContentRenderRevision,
  setHoveredElement,
  setOverviewSelectedScreenIds,
  setPendingLiveNonStyleEdits,
  setPendingVisualStyleEdits,
  setSelectedElement,
  setSelectedLayerIdsState,
  suppressContentHistoryRef,
  syncLiveScreenSnapshotPreview,
  syncUndoRedoState,
  t,
  undoManagerRef,
  updateLiveScreenSnapshotContent,
  viewModeRef,
  writeFrameGeometrySnapshot,
  ydoc,
}: UndoArgs) {
  trace("history", "undo", {});
  if (!canEditDesign) return;
  // U10: an in-progress drag hasn't been committed yet (onGeometryCommit /
  // the content update fires on drag END), so undoing mid-drag would pop a
  // PRIOR entry while the live-but-uncommitted drag is still moving the
  // element — the drag's eventual commit would then stomp the undo. Block
  // until the drag finishes (or is cancelled).
  if (activeEditorDragRef.current) return;
  if (fileHistoryMutationPendingRef.current) return;
  const pendingStyleUndoStack = pendingVisualStyleUndoStackRef.current;
  const pendingStyleUndo =
    pendingStyleUndoStack[pendingStyleUndoStack.length - 1];
  const pendingNonStyleUndoStack = pendingLiveNonStyleUndoStackRef.current;
  const pendingNonStyleUndo =
    pendingNonStyleUndoStack[pendingNonStyleUndoStack.length - 1];
  if (
    pendingNonStyleUndo &&
    (!pendingStyleUndo ||
      pendingNonStyleUndo.edit.updatedAt > pendingStyleUndo.edit.updatedAt)
  ) {
    const nextUndoStack = pendingNonStyleUndoStack.slice(0, -1);
    pendingLiveNonStyleUndoStackRef.current = nextUndoStack;
    const nextPending = mergePendingLiveNonStyleEdits(
      nextUndoStack.map((entry) => entry.edit),
    );
    pendingLiveNonStyleEditsRef.current = nextPending;
    pendingLiveNonStyleRedoStackRef.current = [
      ...pendingLiveNonStyleRedoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      pendingNonStyleUndo,
    ];
    requestPendingLiveNonStyleRevert([
      pendingNonStyleUndo.kind === "text"
        ? {
            ...pendingNonStyleUndo.edit,
            originalValue: pendingNonStyleUndo.revertValue,
            originalHtml: pendingNonStyleUndo.revertHtml,
          }
        : pendingNonStyleUndo.kind === "layer-state"
          ? {
              ...pendingNonStyleUndo.edit,
              originalEnabled: pendingNonStyleUndo.revertEnabled,
            }
          : pendingNonStyleUndo.edit,
    ]);
    setPendingLiveNonStyleEdits(nextPending);
    // Bug fix — undo reverted the DOM via requestPendingLiveNonStyleRevert
    // above but never resynced the inspector panel's selectedElement, so
    // the right panel kept showing pre-undo text until deselect/reselect.
    // Mirrors recordPendingVisualStyleEdit's direct object-patch resync
    // (~line 9514): a plain merge of the revert payload already on this
    // undo entry, not a DOM re-query or content-string rebuild (those
    // don't exist for pending live edits, which never touch
    // ydoc/activeFile.content).
    if (
      pendingNonStyleUndo.kind === "text" &&
      pendingNonStyleUndo.edit.screenId === activeFile?.id
    ) {
      const { sourceId: revertedSourceId, selector: revertedSelector } =
        pendingNonStyleUndo.edit;
      const { revertValue, revertHtml } = pendingNonStyleUndo;
      setSelectedElement((prev) => {
        if (!prev) return prev;
        if (
          !pendingEditTargetsSelectedElement({
            editSourceId: revertedSourceId,
            editSelector: revertedSelector,
            selectedSourceId: prev.sourceId,
            selectedSelector: prev.selector,
          })
        ) {
          return prev;
        }
        return {
          ...prev,
          textContent: revertValue,
          htmlContent: revertHtml ?? prev.htmlContent,
        };
      });
    }
    syncUndoRedoState();
    return;
  }
  if (pendingStyleUndo) {
    const nextUndoStack = pendingStyleUndoStack.slice(0, -1);
    pendingVisualStyleUndoStackRef.current = nextUndoStack;
    const nextPending = mergePendingVisualStyleEdits(
      nextUndoStack.map((entry) => entry.edit),
    );
    pendingVisualStyleEditsRef.current = nextPending;
    pendingVisualStyleRedoStackRef.current = [
      ...pendingVisualStyleRedoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      pendingStyleUndo,
    ];
    requestPendingVisualStyleRevert([
      {
        ...pendingStyleUndo.edit,
        originalStyles: pendingStyleUndo.revertStyles,
      },
    ]);
    setPendingVisualStyleEdits(nextPending);
    // Bug fix — same stale-inspector-panel issue as the pendingNonStyleUndo
    // branch above, for style undo. Merge the reverted style values
    // (already computed as pendingStyleUndo.revertStyles) into
    // selectedElement.computedStyles, guarded to the currently-selected
    // element so an undo on a different/background screen doesn't
    // clobber the panel for whatever the user has selected right now.
    if (pendingStyleUndo.edit.screenId === activeFile?.id) {
      const {
        sourceId: revertedStyleSourceId,
        selector: revertedStyleSelector,
      } = pendingStyleUndo.edit;
      const revertedStyles = pendingStyleUndo.edit.interactionState
        ? Object.fromEntries(
            Object.entries(pendingStyleUndo.revertStyles).map(
              ([property, value]) => [
                property,
                value || pendingStyleUndo.edit.baseStyles?.[property] || "",
              ],
            ),
          )
        : pendingStyleUndo.revertStyles;
      setSelectedElement((prev) => {
        if (!prev) return prev;
        if (
          !pendingEditTargetsSelectedElement({
            editSourceId: revertedStyleSourceId,
            editSelector: revertedStyleSelector,
            selectedSourceId: prev.sourceId,
            selectedSelector: prev.selector,
          })
        ) {
          return prev;
        }
        return {
          ...prev,
          computedStyles: {
            ...prev.computedStyles,
            ...revertedStyles,
          },
        };
      });
    }
    syncUndoRedoState();
    return;
  }
  const clipboardPasteUndo =
    clipboardPasteUndoStackRef.current[
      clipboardPasteUndoStackRef.current.length - 1
    ];
  if (clipboardPasteUndo) {
    const currentContent =
      latestClipboardMutationContentRef.current.get(clipboardPasteUndo.fileId)
        ?.content ??
      pendingLocalFileContentsRef.current.get(clipboardPasteUndo.fileId)
        ?.content ??
      (clipboardPasteUndo.fileId === activeFile?.id
        ? getFreshActiveContent()
        : (getScreenContent(clipboardPasteUndo.fileId) ?? ""));
    // Only claim the command when this paste is still the top document
    // state. If another edit followed it, the ordinary chronological
    // history below gets first chance; once that edit is undone back to
    // `after`, the next Cmd+Z reaches this immutable paste entry.
    if (currentContent === clipboardPasteUndo.after) {
      const clipboardMutation = publishAuthoritativeClipboardMutation({
        fileId: clipboardPasteUndo.fileId,
        baseContent: clipboardPasteUndo.after,
        nextContent: clipboardPasteUndo.before,
        origin: "clipboard-undo",
      });
      if (!clipboardMutation) return;
      clipboardPasteUndoStackRef.current =
        clipboardPasteUndoStackRef.current.slice(0, -1);
      clipboardPasteRedoStackRef.current = [
        ...clipboardPasteRedoStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        clipboardPasteUndo,
      ];
      if (clipboardPasteUndo.fileId === activeFile?.id) {
        applyLocalContentUpdate(clipboardPasteUndo.before, {
          recordHistory: false,
          forcePreviewFullDocument: true,
          immediateSave: true,
          clipboardMutation,
        });
      } else {
        applyFileContentUpdate(
          clipboardPasteUndo.fileId,
          clipboardPasteUndo.before,
          {
            recordHistory: false,
            forcePreviewFullDocument: true,
            clipboardMutation,
          },
        );
      }
      setSelectedElement((previous) =>
        previous
          ? refreshElementInfoFromContent(clipboardPasteUndo.before, previous)
          : previous,
      );
      setSelectedLayerIdsState((previous) =>
        refreshSelectedLayerIdsFromContent(clipboardPasteUndo.before, previous),
      );
      syncUndoRedoState();
      return;
    }
  }
  const um = undoManagerRef.current;
  const canUseOverviewHistory = viewModeRef.current === "overview";
  let prunedUndoHistory = 0;
  const undoContent = (scope: "any" | "local" | "global" = "any") => {
    if (scope !== "global" && um?.canUndo()) {
      um.undo();
      if (ydoc && activeFile) {
        const next = ydoc.getText("content").toString();
        markPendingLocalFileContent(activeFile.id, next, activeFile.updatedAt);
        lastLocalContentRef.current = next;
        queueFileContentSave(activeFile.id, next, {
          syncCollab: !(ydoc && isSynced),
        });
        // Holistic flash pipeline: only fall back to a full srcdoc rebuild
        // (real iframe reload) when the live in-place patch genuinely
        // failed — replaceRuntimeDocument's forceFullDocument branch already
        // swaps content inside the SAME live iframe (no navigation), so
        // bumping contentRenderRevision unconditionally right after a
        // successful in-place replace was a redundant second reload and the
        // dominant cause of "undo/redo flashes heavily".
        if (
          previewContentReplaceNeedsRenderFallback(
            replacePreviewContent(next, null, {
              forceFullDocument: true,
            }),
          )
        ) {
          setContentRenderRevision((revision) => revision + 1);
        }
        // Clear stale selection if the undo removed the selected element.
        setSelectedElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev);
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev);
        });
        // U18: keep the layers-panel highlight in sync too.
        setSelectedLayerIdsState((prev) =>
          refreshSelectedLayerIdsFromContent(next, prev),
        );
      }
      // Drop the matching local fallback mirror (see U3) so it can't be
      // replayed a second time via the fallthrough path below once the Yjs
      // UndoManager for this file is later torn down.
      const mirroredIndex = findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeFile?.id,
      );
      if (mirroredIndex !== -1) {
        localContentUndoStackRef.current =
          localContentUndoStackRef.current.filter(
            (_, index) => index !== mirroredIndex,
          );
      }
      redoOrderRef.current = [
        ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      return true;
    }

    if (!canUseOverviewHistory && scope !== "global" && activeFile?.id) {
      const localIndex = findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeFile.id,
      );
      if (localIndex !== -1) {
        const [entry] = localContentUndoStackRef.current.splice(localIndex, 1);
        if (entry) {
          localContentRedoStackRef.current = [
            ...localContentRedoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            entry,
          ];
          // U20: route a live-snapshot screen's replay through
          // updateLiveScreenSnapshotContent — see the matching note above.
          if (liveScreenSnapshotsById[entry.fileId]) {
            updateLiveScreenSnapshotContent(entry.fileId, entry.before, {
              recordHistory: false,
            });
            syncLiveScreenSnapshotPreview(entry.fileId, entry.before);
          } else {
            applyLocalContentUpdate(entry.before, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
          }
          setSelectedElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.before, prev);
          });
          setHoveredElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.before, prev);
          });
          // U18: keep the layers-panel highlight in sync too.
          setSelectedLayerIdsState((prev) =>
            refreshSelectedLayerIdsFromContent(entry.before, prev),
          );
          return true;
        }
      }
    }

    if (scope === "local") return false;
    if (!canUseOverviewHistory) return false;
    const entry =
      contentUndoStackRef.current[contentUndoStackRef.current.length - 1];
    if (!entry) return false;
    const entrySelection =
      contentUndoSelectionStackRef.current[
        contentUndoSelectionStackRef.current.length - 1
      ];
    const changes = getAvailableContentHistoryChanges(
      entry,
      files.map((file) => file.id),
      activeFile?.id,
    );
    if (changes.length === 0) {
      contentUndoStackRef.current.pop();
      contentUndoSelectionStackRef.current.pop();
      prunedUndoHistory += 1;
      return false;
    }
    contentUndoStackRef.current.pop();
    contentUndoSelectionStackRef.current.pop();
    contentRedoStackRef.current = [
      ...contentRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    contentRedoSelectionStackRef.current = [
      ...contentRedoSelectionStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      entrySelection,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-content",
    ];
    suppressContentHistoryRef.current = true;
    try {
      for (const change of changes) {
        // U20: a live-snapshot (URL-backed/localhost) screen's visible
        // content lives in liveScreenSnapshotsById, not DesignFile.content
        // — route replay there instead of the regular content path, which
        // that screen's edits never actually write to.
        if (liveScreenSnapshotsById[change.fileId]) {
          updateLiveScreenSnapshotContent(change.fileId, change.before, {
            recordHistory: false,
          });
          syncLiveScreenSnapshotPreview(change.fileId, change.before);
        } else if (change.fileId === activeFile?.id) {
          applyLocalContentUpdate(change.before, {
            refreshPreview: false,
            forcePreviewFullDocument: true,
            immediateSave: true,
            recordHistory: false,
          });
        } else {
          applyFileContentUpdate(change.fileId, change.before, {
            recordHistory: false,
            refreshPreview: false,
          });
        }
      }
    } finally {
      suppressContentHistoryRef.current = false;
    }
    const activeChange = changes.find(
      (change) => change.fileId === activeFile?.id,
    );
    if (activeChange) {
      setSelectedElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.before, prev);
      });
      setHoveredElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.before, prev);
      });
      // U18: keep the layers-panel highlight in sync too.
      setSelectedLayerIdsState((prev) =>
        refreshSelectedLayerIdsFromContent(activeChange.before, prev),
      );
    }
    // Figma-parity undo/redo selection restore: overrides the
    // refreshSelectedLayerIdsFromContent heuristic just above with the
    // actual captured selection, when one was recorded for this entry.
    restoreSelectionSnapshot(entrySelection);
    return true;
  };
  const undoGeometry = () => {
    if (!canUseOverviewHistory) return false;
    const entry = geometryUndoStackRef.current.pop();
    if (!entry) return false;
    // Freshness guard: this entry last wrote `entry.after`. If a peer/agent
    // has since moved any of the frames it touched, replaying `entry.before`
    // would silently clobber their change — drop this entry instead. The pop
    // above already removed it, so undo skips forward to the next entry.
    const stale = staleGeometryFrameIds(
      entry,
      liveFrameGeometryRef.current,
      entry.after,
    );
    if (stale.length > 0) {
      console.debug(
        "[design] skipping stale geometry undo; frames changed since capture:",
        stale,
      );
      toast.info(t("designEditor.toasts.undoSkippedConcurrentEdit"));
      // Try the next undo entry rather than swallowing the whole gesture.
      return undoGeometry();
    }
    geometryRedoStackRef.current = [
      ...geometryRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "geometry",
    ];
    // U11: merge only this entry's per-frame diff onto the CURRENT live
    // map (read fresh from the ref) instead of replacing the whole board
    // with the entry's stale whole-board snapshot — otherwise a frame
    // created after this entry was recorded has no key in entry.before
    // and would be wiped out by a full-map replace.
    writeFrameGeometrySnapshot(
      applyGeometryHistoryDiff(
        getCanvasFrameGeometry(designDataJsonRef.current),
        entry,
        "undo",
      ),
      {
        syncViewportFrameIds: viewportChangedFrameIds(
          entry.after,
          entry.before,
        ),
      },
    );
    // Figma parity: undo re-selects whatever was selected when this
    // gesture's change was originally made.
    restoreSelectionSnapshot(entry.selectionBefore);
    return true;
  };
  // U12: undo a screen create/duplicate by soft-deleting the file it
  // created (performDeleteFiles already prunes any content/geometry undo
  // entries for that file, mirroring U2's screen-deletion cleanup).
  // Resolved by filename at undo time (filenames are unique) since the
  // entry itself doesn't carry the id assigned by the create mutation.
  const undoFileCreation = () => {
    if (!canUseOverviewHistory) return false;
    const entry = fileCreationUndoStackRef.current.pop();
    if (!entry) return false;
    const createdFile = files.find((file) => file.filename === entry.filename);
    if (!createdFile) return false;
    fileCreationRedoStackRef.current = [
      ...fileCreationRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-created",
    ];
    // skipFileCreationRedoPrune: the entry was just pushed onto the redo
    // stack above for this exact filename — without this flag
    // performDeleteFiles' filename-keyed redo prune would immediately pop
    // it back off, leaving redo permanently empty after this undo.
    performDeleteFiles([createdFile], { skipFileCreationRedoPrune: true });
    return true;
  };
  const undoFileDeletion = () => {
    if (!canUseOverviewHistory || !id) return false;
    const entry = fileDeletionUndoStackRef.current.pop();
    if (!entry) return false;

    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
    void (async () => {
      const recreatedIds: string[] = [];
      try {
        for (const file of entry.files) {
          const result = (await createFileMutation.mutateAsync({
            designId: id,
            filename: file.filename,
            content: file.content,
            fileType: file.fileType,
          } as any)) as { id?: string };
          if (!result.id) {
            throw new Error(`Failed to restore "${file.filename}"`);
          }
          recreatedIds.push(result.id);
        }

        const recreatedEntry = remapFileDeletionHistoryEntryIds(
          entry,
          recreatedIds,
        );
        if (recreatedEntry.files.length !== entry.files.length) {
          throw new Error("Failed to restore every deleted screen");
        }
        fileDeletionRedoStackRef.current = [
          ...fileDeletionRedoStackRef.current.slice(
            -(MAX_DESIGN_UNDO_STACK - 1),
          ),
          recreatedEntry,
        ];
        redoOrderRef.current = [
          ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "file-deleted",
        ];

        const nextGeometry = {
          ...getCanvasFrameGeometry(designDataJsonRef.current),
        };
        recreatedEntry.files.forEach((file, index) => {
          const geometry = entry.files[index]?.geometry;
          if (geometry) nextGeometry[file.id] = geometry;
        });
        writeFrameGeometrySnapshot(nextGeometry);
        queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });

        const firstRestoredId = recreatedEntry.files[0]?.id;
        if (firstRestoredId) {
          setActiveFileId(firstRestoredId);
          setOverviewSelectedScreenIds(
            recreatedEntry.files.map((file) => file.id),
          );
          setSelectedLayerIdsState(recreatedEntry.files.map((file) => file.id));
        }
      } catch (error) {
        await Promise.allSettled(
          recreatedIds.map((fileId) =>
            deleteFileMutation.mutateAsync({ id: fileId } as any),
          ),
        );
        fileDeletionUndoStackRef.current = [
          ...fileDeletionUndoStackRef.current.slice(
            -(MAX_DESIGN_UNDO_STACK - 1),
          ),
          entry,
        ];
        historyOrderRef.current = [
          ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "file-deleted",
        ];
        queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
        toast.error(
          error instanceof Error ? error.message : t("common.genericError"),
        );
      } finally {
        fileHistoryMutationPendingRef.current = false;
        syncUndoRedoState();
      }
    })();
    return true;
  };

  const undoByOrder = (preferred?: UndoRedoOrderKind) => {
    if (preferred === "file-deleted") {
      return (
        undoFileDeletion() ||
        undoFileCreation() ||
        undoContent() ||
        undoGeometry()
      );
    }
    if (preferred === "file-created")
      return (
        undoFileCreation() ||
        undoFileDeletion() ||
        undoContent() ||
        undoGeometry()
      );
    if (preferred === "geometry") return undoGeometry() || undoContent();
    if (preferred === "file-content") {
      const prunedBefore = prunedUndoHistory;
      if (undoContent("global")) return true;
      if (prunedUndoHistory > prunedBefore) return false;
      return undoGeometry();
    }
    if (preferred === "content") {
      const prunedBefore = prunedUndoHistory;
      return (
        undoContent("local") ||
        undoContent("global") ||
        (prunedUndoHistory > prunedBefore ? false : undoGeometry())
      );
    }
    return undoFileDeletion() || undoContent() || undoGeometry();
  };
  let didUndo = false;
  if (canUseOverviewHistory) {
    while (!didUndo) {
      const preferred = historyOrderRef.current.pop();
      didUndo = undoByOrder(preferred);
      if (didUndo || preferred === undefined) break;
    }
  } else {
    didUndo = undoContent("local");
  }
  if (didUndo || prunedUndoHistory > 0) {
    syncUndoRedoState();
  }
}

import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
  RuntimeStructureMoveRequest,
} from "@/components/design/types";
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
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
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
  filterFileDeletionHistoryEntry,
  findLastContentHistoryChangeIndex,
  getAvailableContentHistoryChanges,
  removeRecentUndoRedoOrderKinds,
} from "@/pages/design-editor/history";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveNonStyleUndoEntry,
  PendingLiveStructureUndoEntry,
  PendingVisualStyleEdit,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  buildPendingVisualStyleRevertPatches,
  mergePendingLiveNonStyleEdits,
  mergePendingVisualStyleEdits,
  pendingStructureRedoCommand,
  shouldRedoPendingLiveNonStyleBeforeStyle,
} from "@/pages/design-editor/pending-edits";
import { pendingEditTargetsSelectedElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RedoArgs {
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
  deleteRuntimeElement: (
    selector?: string | null,
    candidates?: readonly string[],
    requestId?: string,
  ) => boolean;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  fileCreationRedoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileCreationUndoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileDeletionRedoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileDeletionUndoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileHistoryMutationPendingRef: RefObject<boolean>;
  files: DesignFile[];
  focusCreatedScreen: (screenId: string, geometry: FrameGeometry) => void;
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
  optimisticallyInsertCreatedFile: (args: {
    fileId: string;
    filename: string;
    fileType: DesignFile["fileType"];
    content: string;
    result?: Record<string, unknown> | null;
  }) => void;
  overviewScreens: OverviewScreen[];
  pendingLiveNonStyleEditsRef: RefObject<PendingLiveNonStyleEdit[]>;
  pendingLiveNonStyleRedoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLiveNonStyleUndoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  pendingStructureRedoReplayRef: RefObject<
    PendingLiveStructureUndoEntry | undefined
  >;
  pendingStructureRedoReplayTimerRef: RefObject<number | undefined>;
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
  recordLocalContentHistoryChangeFallback: (
    change: ContentHistoryChange,
  ) => void;
  redoOrderRef: RefObject<UndoRedoOrderKind[]>;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  restoreSelectionSnapshot: (
    selection: GeometryHistorySelection | undefined,
  ) => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  runtimeStructureMoveRevisionRef: RefObject<number>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setPendingLayerStateReplayRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      patches: Array<{
        screenId: string;
        layerId: string;
        state: "hidden" | "locked";
        enabled: boolean;
      }>;
    } | null>
  >;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
  setPendingTextRevertRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      patches: Array<{
        screenId: string;
        selector: string;
        sourceId?: string | null;
        value: string;
        html?: string;
      }>;
    } | null>
  >;
  setPendingVisualStyleEdits: Dispatch<
    SetStateAction<PendingVisualStyleEdit[]>
  >;
  setPendingVisualStyleRevertRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      patches: ReturnType<typeof buildPendingVisualStyleRevertPatches>;
    } | null>
  >;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  setRuntimeStructureMoveRequest: Dispatch<
    SetStateAction<(RuntimeStructureMoveRequest & { screenId: string }) | null>
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

export function runRedo({
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
  deleteRuntimeElement,
  designDataJsonRef,
  fileCreationRedoStackRef,
  fileCreationUndoStackRef,
  fileDeletionRedoStackRef,
  fileDeletionUndoStackRef,
  fileHistoryMutationPendingRef,
  files,
  focusCreatedScreen,
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
  optimisticallyInsertCreatedFile,
  overviewScreens,
  pendingLiveNonStyleEditsRef,
  pendingLiveNonStyleRedoStackRef,
  pendingLiveNonStyleUndoStackRef,
  pendingLocalFileContentsRef,
  pendingStructureRedoReplayRef,
  pendingStructureRedoReplayTimerRef,
  pendingVisualStyleEditsRef,
  pendingVisualStyleRedoStackRef,
  pendingVisualStyleUndoStackRef,
  performDeleteFiles,
  publishAuthoritativeClipboardMutation,
  queryClient,
  queueFileContentSave,
  recordLocalContentHistoryChangeFallback,
  redoOrderRef,
  replacePreviewContent,
  restoreSelectionSnapshot,
  runtimeStructureInsertRevisionRef,
  runtimeStructureMoveRevisionRef,
  setContentRenderRevision,
  setHoveredElement,
  setPendingLayerStateReplayRequest,
  setPendingLiveNonStyleEdits,
  setPendingTextRevertRequest,
  setPendingVisualStyleEdits,
  setPendingVisualStyleRevertRequest,
  setRuntimeStructureInsertRequest,
  setRuntimeStructureMoveRequest,
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
}: RedoArgs) {
  trace("history", "redo", {});
  if (!canEditDesign) return;
  // U10: see the matching guard in handleUndo — don't redo into a document
  // state an in-progress, uncommitted drag is about to overwrite anyway.
  if (activeEditorDragRef.current) return;
  if (fileHistoryMutationPendingRef.current) return;
  const pendingNonStyleRedoStack = pendingLiveNonStyleRedoStackRef.current;
  const pendingNonStyleRedo =
    pendingNonStyleRedoStack[pendingNonStyleRedoStack.length - 1];
  const pendingLiveRedoStack = pendingVisualStyleRedoStackRef.current;
  const pendingLiveRedo = pendingLiveRedoStack[pendingLiveRedoStack.length - 1];
  const redoPendingNonStyleFirst = shouldRedoPendingLiveNonStyleBeforeStyle(
    pendingLiveRedo,
    pendingNonStyleRedo,
  );
  if (redoPendingNonStyleFirst && pendingNonStyleRedo?.kind === "structure") {
    const redoCommand = pendingStructureRedoCommand(pendingNonStyleRedo.edit);
    // A removal has no bridge echo to wait for: re-issuing the delete under
    // the same requestId is the whole replay, so move the entry back onto
    // the undo stack here instead of arming pendingStructureRedoReplayRef
    // for a `visual-structure-change` that will never arrive.
    if (redoCommand.kind === "delete") {
      const redoneEdit = pendingNonStyleRedo.edit;
      if (
        !deleteRuntimeElement(
          redoneEdit.selector,
          [redoneEdit.selector],
          redoneEdit.requestId,
        )
      ) {
        return;
      }
      pendingLiveNonStyleRedoStackRef.current = pendingNonStyleRedoStack.slice(
        0,
        -1,
      );
      pendingLiveNonStyleUndoStackRef.current = [
        ...pendingLiveNonStyleUndoStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        pendingNonStyleRedo,
      ];
      const nextPending = mergePendingLiveNonStyleEdits(
        pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit),
      );
      pendingLiveNonStyleEditsRef.current = nextPending;
      setPendingLiveNonStyleEdits(nextPending);
      syncUndoRedoState();
      return;
    }
    if (pendingStructureRedoReplayRef.current) return;
    pendingStructureRedoReplayRef.current = pendingNonStyleRedo;
    if (redoCommand.kind === "insert") {
      runtimeStructureInsertRevisionRef.current += 1;
      setRuntimeStructureInsertRequest({
        requestId: runtimeStructureInsertRevisionRef.current,
        screenId: pendingNonStyleRedo.edit.screenId,
        html: redoCommand.html,
        replaceAnchor: redoCommand.replaceAnchor,
        anchor: {
          selector: pendingNonStyleRedo.edit.anchorSelector,
          sourceId: pendingNonStyleRedo.edit.anchorSourceId ?? undefined,
        },
        placement: pendingNonStyleRedo.edit.placement,
      });
      if (pendingStructureRedoReplayTimerRef.current !== undefined) {
        window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      }
      pendingStructureRedoReplayTimerRef.current = window.setTimeout(() => {
        pendingStructureRedoReplayRef.current = undefined;
        pendingStructureRedoReplayTimerRef.current = undefined;
        syncUndoRedoState();
      }, 1_000);
      syncUndoRedoState();
      return;
    }
    runtimeStructureMoveRevisionRef.current += 1;
    setRuntimeStructureMoveRequest({
      requestId: runtimeStructureMoveRevisionRef.current,
      screenId: pendingNonStyleRedo.edit.screenId,
      subject: {
        selector: pendingNonStyleRedo.edit.selector,
        sourceId: pendingNonStyleRedo.edit.sourceId ?? undefined,
      },
      anchor: {
        selector: pendingNonStyleRedo.edit.anchorSelector,
        sourceId: pendingNonStyleRedo.edit.anchorSourceId ?? undefined,
      },
      placement: pendingNonStyleRedo.edit.placement,
    });
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
    }
    pendingStructureRedoReplayTimerRef.current = window.setTimeout(() => {
      pendingStructureRedoReplayRef.current = undefined;
      pendingStructureRedoReplayTimerRef.current = undefined;
      syncUndoRedoState();
    }, 1_000);
    syncUndoRedoState();
    return;
  }
  if (redoPendingNonStyleFirst && pendingNonStyleRedo?.kind === "layer-state") {
    pendingLiveNonStyleRedoStackRef.current = pendingNonStyleRedoStack.slice(
      0,
      -1,
    );
    pendingLiveNonStyleUndoStackRef.current = [
      ...pendingLiveNonStyleUndoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      pendingNonStyleRedo,
    ];
    const nextPending = mergePendingLiveNonStyleEdits(
      pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit),
    );
    pendingLiveNonStyleEditsRef.current = nextPending;
    setPendingLayerStateReplayRequest({
      requestId: Date.now() + Math.random(),
      patches: [
        {
          screenId: pendingNonStyleRedo.edit.screenId,
          layerId: pendingNonStyleRedo.edit.layerId,
          state: pendingNonStyleRedo.edit.state,
          enabled: pendingNonStyleRedo.edit.enabled,
        },
      ],
    });
    setPendingLiveNonStyleEdits(nextPending);
    syncUndoRedoState();
    return;
  }
  if (redoPendingNonStyleFirst && pendingNonStyleRedo?.kind === "text") {
    const pendingTextRedo = pendingNonStyleRedo;
    pendingLiveNonStyleRedoStackRef.current = pendingNonStyleRedoStack.slice(
      0,
      -1,
    );
    pendingLiveNonStyleUndoStackRef.current = [
      ...pendingLiveNonStyleUndoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      pendingTextRedo,
    ];
    const nextPending = mergePendingLiveNonStyleEdits(
      pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit),
    );
    pendingLiveNonStyleEditsRef.current = nextPending;
    setPendingTextRevertRequest({
      requestId: Date.now() + Math.random(),
      patches: [
        {
          screenId: pendingTextRedo.edit.screenId,
          selector: pendingTextRedo.edit.selector,
          sourceId: pendingTextRedo.edit.sourceId,
          value: pendingTextRedo.edit.value,
          html: pendingTextRedo.edit.html,
        },
      ],
    });
    setPendingLiveNonStyleEdits(nextPending);
    // Bug fix — same stale-inspector-panel issue as handleUndo. Redo
    // reapplies pendingTextRedo.edit.value/html via
    // setPendingTextRevertRequest above, but never resynced
    // selectedElement, so resync with the same values here.
    if (pendingTextRedo.edit.screenId === activeFile?.id) {
      const {
        sourceId: redoneSourceId,
        selector: redoneSelector,
        value: redoneValue,
        html: redoneHtml,
      } = pendingTextRedo.edit;
      setSelectedElement((prev) => {
        if (!prev) return prev;
        if (
          !pendingEditTargetsSelectedElement({
            editSourceId: redoneSourceId,
            editSelector: redoneSelector,
            selectedSourceId: prev.sourceId,
            selectedSelector: prev.selector,
          })
        ) {
          return prev;
        }
        return {
          ...prev,
          textContent: redoneValue,
          htmlContent: redoneHtml ?? prev.htmlContent,
        };
      });
    }
    syncUndoRedoState();
    return;
  }
  if (pendingLiveRedo) {
    const nextRedoStack = pendingLiveRedoStack.slice(0, -1);
    pendingVisualStyleRedoStackRef.current = nextRedoStack;
    pendingVisualStyleUndoStackRef.current = [
      ...pendingVisualStyleUndoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      pendingLiveRedo,
    ];
    const nextPending = mergePendingVisualStyleEdits(
      pendingVisualStyleUndoStackRef.current.map((entry) => entry.edit),
    );
    pendingVisualStyleEditsRef.current = nextPending;
    setPendingVisualStyleRevertRequest({
      requestId: Date.now() + Math.random(),
      patches: [
        {
          screenId: pendingLiveRedo.edit.screenId,
          selector: pendingLiveRedo.edit.selector,
          sourceId: pendingLiveRedo.edit.sourceId,
          // Redo builds its patch inline rather than through
          // buildPendingVisualStyleRevertPatches, so it needs the runtime
          // pair explicitly or it re-applies into the wrong namespace.
          runtimeSelector: pendingLiveRedo.edit.runtimeSelector,
          runtimeSourceId: pendingLiveRedo.edit.runtimeSourceId,
          styles: pendingLiveRedo.edit.styles,
          interactionState: pendingLiveRedo.edit.interactionState,
        },
      ],
    });
    setPendingVisualStyleEdits(nextPending);
    // Bug fix — same stale-inspector-panel issue as handleUndo's style
    // branch. Merge the redo's own style values (already applied to the
    // DOM via setPendingVisualStyleRevertRequest above) into
    // selectedElement.computedStyles.
    if (pendingLiveRedo.edit.screenId === activeFile?.id) {
      const {
        sourceId: redoneStyleSourceId,
        selector: redoneStyleSelector,
        styles: redoneStyles,
      } = pendingLiveRedo.edit;
      setSelectedElement((prev) => {
        if (!prev) return prev;
        if (
          !pendingEditTargetsSelectedElement({
            editSourceId: redoneStyleSourceId,
            editSelector: redoneStyleSelector,
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
            ...redoneStyles,
          },
        };
      });
    }
    syncUndoRedoState();
    return;
  }
  const clipboardPasteRedo =
    clipboardPasteRedoStackRef.current[
      clipboardPasteRedoStackRef.current.length - 1
    ];
  if (clipboardPasteRedo) {
    const currentContent =
      latestClipboardMutationContentRef.current.get(clipboardPasteRedo.fileId)
        ?.content ??
      pendingLocalFileContentsRef.current.get(clipboardPasteRedo.fileId)
        ?.content ??
      (clipboardPasteRedo.fileId === activeFile?.id
        ? getFreshActiveContent()
        : (getScreenContent(clipboardPasteRedo.fileId) ?? ""));
    if (currentContent === clipboardPasteRedo.before) {
      const clipboardMutation = publishAuthoritativeClipboardMutation({
        fileId: clipboardPasteRedo.fileId,
        baseContent: clipboardPasteRedo.before,
        nextContent: clipboardPasteRedo.after,
        origin: "clipboard-redo",
      });
      if (!clipboardMutation) return;
      clipboardPasteRedoStackRef.current =
        clipboardPasteRedoStackRef.current.slice(0, -1);
      clipboardPasteUndoStackRef.current = [
        ...clipboardPasteUndoStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        clipboardPasteRedo,
      ];
      if (clipboardPasteRedo.fileId === activeFile?.id) {
        applyLocalContentUpdate(clipboardPasteRedo.after, {
          recordHistory: false,
          forcePreviewFullDocument: true,
          immediateSave: true,
          clipboardMutation,
        });
      } else {
        applyFileContentUpdate(
          clipboardPasteRedo.fileId,
          clipboardPasteRedo.after,
          {
            recordHistory: false,
            forcePreviewFullDocument: true,
            clipboardMutation,
          },
        );
      }
      syncUndoRedoState();
      return;
    }
  }
  const um = undoManagerRef.current;
  const canUseOverviewHistory = viewModeRef.current === "overview";
  let prunedRedoHistory = 0;
  const redoContent = (scope: "any" | "local" | "global" = "any") => {
    if (scope !== "global" && um?.canRedo()) {
      const beforeRedoContent = ydoc?.getText("content").toString();
      um.redo();
      if (ydoc && activeFile) {
        const next = ydoc.getText("content").toString();
        markPendingLocalFileContent(activeFile.id, next, activeFile.updatedAt);
        lastLocalContentRef.current = next;
        queueFileContentSave(activeFile.id, next, {
          syncCollab: !(ydoc && isSynced),
        });
        // Holistic flash pipeline: see the matching comment in handleUndo —
        // only fall back to a full srcdoc rebuild when the in-place bridge
        // patch genuinely failed, instead of always reloading the iframe on
        // top of an already-successful in-place replace.
        if (
          previewContentReplaceNeedsRenderFallback(
            replacePreviewContent(next, null, {
              forceFullDocument: true,
            }),
          )
        ) {
          setContentRenderRevision((revision) => revision + 1);
        }
        // Clear stale selection if the redo removed the selected element.
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
        // Restore the local fallback mirror (see U3) that undoContent()
        // dropped, so it survives a UndoManager teardown right after redo.
        if (
          typeof beforeRedoContent === "string" &&
          beforeRedoContent !== next
        ) {
          recordLocalContentHistoryChangeFallback({
            fileId: activeFile.id,
            before: beforeRedoContent,
            after: next,
          });
        }
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      return true;
    }

    if (!canUseOverviewHistory && scope !== "global" && activeFile?.id) {
      const localIndex = findLastContentHistoryChangeIndex(
        localContentRedoStackRef.current,
        activeFile.id,
      );
      if (localIndex !== -1) {
        const [entry] = localContentRedoStackRef.current.splice(localIndex, 1);
        if (entry) {
          localContentUndoStackRef.current = [
            ...localContentUndoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            entry,
          ];
          // U20: route a live-snapshot screen's replay through
          // updateLiveScreenSnapshotContent — see the matching note above.
          if (liveScreenSnapshotsById[entry.fileId]) {
            updateLiveScreenSnapshotContent(entry.fileId, entry.after, {
              recordHistory: false,
            });
            syncLiveScreenSnapshotPreview(entry.fileId, entry.after);
          } else {
            applyLocalContentUpdate(entry.after, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
          }
          setSelectedElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.after, prev);
          });
          setHoveredElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.after, prev);
          });
          // U18: keep the layers-panel highlight in sync too.
          setSelectedLayerIdsState((prev) =>
            refreshSelectedLayerIdsFromContent(entry.after, prev),
          );
          return true;
        }
      }
    }

    if (scope === "local") return false;
    if (!canUseOverviewHistory) return false;
    const entry =
      contentRedoStackRef.current[contentRedoStackRef.current.length - 1];
    if (!entry) return false;
    const entrySelection =
      contentRedoSelectionStackRef.current[
        contentRedoSelectionStackRef.current.length - 1
      ];
    const changes = getAvailableContentHistoryChanges(
      entry,
      files.map((file) => file.id),
      activeFile?.id,
    );
    if (changes.length === 0) {
      contentRedoStackRef.current.pop();
      contentRedoSelectionStackRef.current.pop();
      prunedRedoHistory += 1;
      return false;
    }
    contentRedoStackRef.current.pop();
    contentRedoSelectionStackRef.current.pop();
    contentUndoStackRef.current = [
      ...contentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    contentUndoSelectionStackRef.current = [
      ...contentUndoSelectionStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      entrySelection,
    ];
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-content",
    ];
    suppressContentHistoryRef.current = true;
    try {
      for (const change of changes) {
        // U20: see the matching note in handleUndo — route a live-snapshot
        // screen's replay through updateLiveScreenSnapshotContent instead
        // of the regular content path.
        if (liveScreenSnapshotsById[change.fileId]) {
          updateLiveScreenSnapshotContent(change.fileId, change.after, {
            recordHistory: false,
          });
          syncLiveScreenSnapshotPreview(change.fileId, change.after);
        } else if (change.fileId === activeFile?.id) {
          applyLocalContentUpdate(change.after, {
            refreshPreview: false,
            forcePreviewFullDocument: true,
            immediateSave: true,
            recordHistory: false,
          });
        } else {
          applyFileContentUpdate(change.fileId, change.after, {
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
        return refreshElementInfoFromContent(activeChange.after, prev);
      });
      setHoveredElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.after, prev);
      });
      // U18: keep the layers-panel highlight in sync too.
      setSelectedLayerIdsState((prev) =>
        refreshSelectedLayerIdsFromContent(activeChange.after, prev),
      );
    }
    // Figma-parity undo/redo selection restore: see the matching note in
    // undoContent above.
    restoreSelectionSnapshot(entrySelection);
    return true;
  };
  const redoGeometry = () => {
    if (!canUseOverviewHistory) return false;
    const entry = geometryRedoStackRef.current.pop();
    if (!entry) return false;
    // Freshness guard: when this entry was undone it wrote `entry.before`. If
    // a peer/agent has since moved any touched frame, replaying `entry.after`
    // would clobber that change — drop this entry and try the next redo.
    const stale = staleGeometryFrameIds(
      entry,
      liveFrameGeometryRef.current,
      entry.before,
    );
    if (stale.length > 0) {
      console.debug(
        "[design] skipping stale geometry redo; frames changed since capture:",
        stale,
      );
      toast.info(t("designEditor.toasts.redoSkippedConcurrentEdit"));
      return redoGeometry();
    }
    geometryUndoStackRef.current = [
      ...geometryUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "geometry",
    ];
    // U11: see the matching undoGeometry note — merge this entry's diff
    // onto the current live map instead of replacing it wholesale.
    writeFrameGeometrySnapshot(
      applyGeometryHistoryDiff(
        getCanvasFrameGeometry(designDataJsonRef.current),
        entry,
        "redo",
      ),
      {
        syncViewportFrameIds: viewportChangedFrameIds(
          entry.before,
          entry.after,
        ),
      },
    );
    // Figma parity: redo re-selects whatever was selected when this
    // gesture's change was originally made (i.e. the selection AFTER the
    // gesture committed, matching what undo just took away).
    restoreSelectionSnapshot(entry.selectionAfter);
    return true;
  };
  // U12: redo a screen create/duplicate by recreating the file with the
  // same filename/content/fileType and restoring its recorded geometry.
  // This is async (createFileMutation), unlike every other redo path here,
  // so it optimistically reports success immediately (mirrors
  // handleAddScreen's own optimistic cache write) and surfaces a toast on
  // failure instead of rolling the redo stacks back.
  const redoFileCreation = () => {
    if (!canUseOverviewHistory) return false;
    const entry = fileCreationRedoStackRef.current.pop();
    if (!entry) return false;
    if (!id) return false;
    fileCreationUndoStackRef.current = [
      ...fileCreationUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-created",
    ];
    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
    createFileMutation.mutate(
      {
        designId: id,
        filename: entry.filename,
        content: entry.content,
        fileType: entry.fileType,
      } as any,
      {
        onSuccess: (result: any) => {
          const nextId = typeof result?.id === "string" ? result.id : null;
          if (nextId) {
            const geometry = {
              ...getInitialFrameGeometry(overviewScreens.length, {
                width: 1280,
                height: 2560,
              }),
              ...entry.geometry,
            };
            optimisticallyInsertCreatedFile({
              fileId: nextId,
              filename: entry.filename,
              fileType: entry.fileType,
              content: entry.content,
              result,
            });
            writeFrameGeometrySnapshot({
              ...getCanvasFrameGeometry(designDataJsonRef.current),
              [nextId]: geometry,
            });
            focusCreatedScreen(nextId, geometry);
          }
          fileHistoryMutationPendingRef.current = false;
          syncUndoRedoState();
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        },
        onError: (error: unknown) => {
          // The optimistic history move happened before the request. Put the
          // entry back exactly where it came from so a failed redo remains
          // retryable and does not leave a phantom undo operation behind.
          if (
            fileCreationUndoStackRef.current[
              fileCreationUndoStackRef.current.length - 1
            ] === entry
          ) {
            fileCreationUndoStackRef.current =
              fileCreationUndoStackRef.current.slice(0, -1);
          }
          historyOrderRef.current = removeRecentUndoRedoOrderKinds(
            historyOrderRef.current,
            "file-created",
            1,
          );
          fileCreationRedoStackRef.current = [
            ...fileCreationRedoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            entry,
          ];
          redoOrderRef.current = [
            ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
            "file-created",
          ];
          fileHistoryMutationPendingRef.current = false;
          syncUndoRedoState();
          toast.error(
            error instanceof Error
              ? error.message
              : t("designEditor.toasts.screenDuplicateError"),
          );
        },
      },
    );
    return true;
  };
  const redoFileDeletion = () => {
    if (!canUseOverviewHistory) return false;
    const entry = fileDeletionRedoStackRef.current.pop();
    if (!entry) return false;

    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
    performDeleteFiles(entry.files, {
      onMutationSettled: (deletedFiles, failedFiles) => {
        if (deletedFiles.length > 0) {
          const deletedIds = new Set(deletedFiles.map((file) => file.id));
          fileDeletionUndoStackRef.current = [
            ...fileDeletionUndoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            filterFileDeletionHistoryEntry(entry, deletedIds),
          ];
          historyOrderRef.current = [
            ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
            "file-deleted",
          ];
        }
        if (failedFiles.length > 0) {
          const failedIds = new Set(failedFiles.map((file) => file.id));
          fileDeletionRedoStackRef.current = [
            ...fileDeletionRedoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            filterFileDeletionHistoryEntry(entry, failedIds),
          ];
          redoOrderRef.current = [
            ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
            "file-deleted",
          ];
        }
        fileHistoryMutationPendingRef.current = false;
        syncUndoRedoState();
      },
    });
    return true;
  };

  const redoByOrder = (preferred?: UndoRedoOrderKind) => {
    if (preferred === "file-deleted") {
      return (
        redoFileDeletion() ||
        redoFileCreation() ||
        redoContent() ||
        redoGeometry()
      );
    }
    if (preferred === "file-created")
      return (
        redoFileCreation() ||
        redoFileDeletion() ||
        redoContent() ||
        redoGeometry()
      );
    if (preferred === "geometry") return redoGeometry() || redoContent();
    if (preferred === "file-content") {
      const prunedBefore = prunedRedoHistory;
      if (redoContent("global")) return true;
      if (prunedRedoHistory > prunedBefore) return false;
      return redoGeometry();
    }
    if (preferred === "content") {
      const prunedBefore = prunedRedoHistory;
      return (
        redoContent("local") ||
        redoContent("global") ||
        (prunedRedoHistory > prunedBefore ? false : redoGeometry())
      );
    }
    return redoFileDeletion() || redoContent() || redoGeometry();
  };
  let didRedo = false;
  if (canUseOverviewHistory) {
    while (!didRedo) {
      const preferred = redoOrderRef.current.pop();
      didRedo = redoByOrder(preferred);
      if (didRedo || preferred === undefined) break;
    }
  } else {
    didRedo = redoContent("local");
  }
  if (didRedo || prunedRedoHistory > 0) {
    syncUndoRedoState();
  }
}

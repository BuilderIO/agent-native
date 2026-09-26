import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { type CodeLayerNode } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
  RuntimeStructureDeleteRequest,
  RuntimeStructureMoveRequest,
} from "@/components/design/types";
import type {
  ClipboardContentMutationOrigin,
  ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import {
  refreshElementInfoFromContent,
  refreshSelectedLayerIdsFromContent,
} from "@/pages/design-editor/code-layer-state";
import { writeCollabText } from "@/pages/design-editor/collab-sync";
import type { LiveScreenSnapshot } from "@/pages/design-editor/command-types";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import {
  captureDesignFileIds,
  createdFileIdFromResult,
  isPersistedFilePresent,
  reconcileCreatedFile,
} from "@/pages/design-editor/commands/file-creation-recovery";
import { prepareContentHistoryReplay } from "@/pages/design-editor/commands/prepare-content-history-replay";
import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getCanvasFrameGeometry,
  staleGeometryFrameIds,
  viewportChangedFrameIds,
} from "@/pages/design-editor/design-data-geometry-utils";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import type {
  PreviewContentReplaceResult,
  UndoRedoOrderKind,
} from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
  FileCreationHistoryEntry,
  FileDeletionHistoryEntry,
  FileDeletionHistorySnapshot,
  GeometryHistoryEntry,
  GeometryHistorySelection,
  SelectionHistoryEntry,
} from "@/pages/design-editor/history";
import {
  MAX_DESIGN_UNDO_STACK,
  applyGeometryHistoryDiff,
  filterFileDeletionHistoryEntry,
  findLastContentHistoryChangeIndex,
  partitionContentHistoryEntry,
  contentHistoryEntryFromChanges,
  readYjsRedoSelection,
  removeRecentUndoRedoOrderKinds,
  restoreFileContentHistoryOrderToken,
} from "@/pages/design-editor/history";
import {
  resolveHistorySelection,
  resolveLocalHistorySelection,
} from "@/pages/design-editor/history-identity";
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
  pendingLiveNonStyleEditsFromUndoStack,
  pendingLiveStructureEditsFromUndoEntry,
  pendingLiveStructureRedoSourceEdit,
  mergePendingVisualStyleEdits,
  pendingVisualStyleEditsFromUndoStack,
  pendingVisualStyleUndoTargets,
  pendingStructureRedoCommand,
  shouldRedoPendingLiveNonStyleBeforeStyle,
} from "@/pages/design-editor/pending-edits";
import { pendingEditTargetsSelectedElement } from "@/pages/design-editor/selection-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
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
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  applyDesignDataHistoryChanges?: (
    changes: readonly ContentHistoryChange[],
    direction: "undo" | "redo",
  ) => void;
  applyGeometryHistoryContentChanges?: (
    changes: readonly ContentHistoryChange[],
    direction: "undo" | "redo",
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
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  allowPendingLiveEdits?: boolean;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
  clipboardPasteUndoStackRef: RefObject<ContentHistoryChange[]>;
  /** See UndoArgs's matching field doc comment (undo.ts). */
  codeLayerOwnerByNodeIdRef: RefObject<Map<string, { node: CodeLayerNode }>>;
  contentHistorySelectionAfterRef: RefObject<ContentHistorySelectionAfterMap>;
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
  clearPendingHistory?: () => void;
  files: DesignFile[];
  filesRef?: RefObject<DesignFile[]>;
  focusCreatedScreen: (
    screenId: string,
    geometry: FrameGeometry,
    options?: {
      preserveCamera?: boolean;
      suppressLineupRecenter?: boolean;
    },
  ) => void;
  geometryRedoStackRef: RefObject<GeometryHistoryEntry[]>;
  geometryUndoStackRef: RefObject<GeometryHistoryEntry[]>;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  historyOrderRef: RefObject<(UndoRedoOrderKind | "selection")[]>;
  id: string | undefined;
  isSynced: boolean;
  lastLocalContentRef: RefObject<string | null>;
  resetGeometryCommitCoalescing?: () => void;
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
  pendingStructureRedoPreparedEditsRef?: RefObject<unknown>;
  pendingVisualStyleEditsRef: RefObject<PendingVisualStyleEdit[]>;
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  pendingVisualStyleUndoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  replayPendingVisualStyleRuntime?: (
    edits: readonly PendingVisualStyleEdit[],
  ) => number | undefined;
  setPendingVisualStyleBaselineResetRequest?: Dispatch<
    SetStateAction<number | null>
  >;
  performDeleteFiles: (
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
  ) => void;
  publishAuthoritativeClipboardMutation: (args: {
    fileId: string;
    baseContent: string;
    nextContent: string;
    origin: ClipboardContentMutationOrigin;
    baseSource?: "lineage" | "document";
  }) => ClipboardContentMutationPublication | null;
  queryClient: QueryClient;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options: {
      expectedVersionHash: string;
      syncCollab?: boolean;
      immediate?: boolean;
    },
  ) => void;
  recordLocalContentHistoryChangeFallback: (
    change: ContentHistoryChange,
  ) => void;
  redoOrderRef: RefObject<(UndoRedoOrderKind | "selection")[]>;
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
  selectionRedoStackRef: RefObject<SelectionHistoryEntry[]>;
  selectionUndoStackRef: RefObject<SelectionHistoryEntry[]>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setPendingLayerNameReplayRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      patches: Array<{
        screenId: string;
        selector: string;
        sourceId?: string | null;
        name: string;
        routePath?: string;
      }>;
    } | null>
  >;
  setPendingLayerStateReplayRequest: Dispatch<
    SetStateAction<{
      requestId: number;
      patches: Array<{
        screenId: string;
        layerId: string;
        state: "hidden" | "locked";
        enabled: boolean;
        routePath?: string;
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
        routePath?: string;
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
  setRuntimeStructureDeleteRequest?: Dispatch<
    SetStateAction<
      (RuntimeStructureDeleteRequest & { screenId: string }) | null
    >
  >;
  setRuntimeStructureMoveRequest: Dispatch<
    SetStateAction<(RuntimeStructureMoveRequest & { screenId: string }) | null>
  >;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
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
  updateDesignAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-design">
  >["mutateAsync"];
  viewModeRef: RefObject<"single" | "overview">;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: {
      replacePendingGeometrySave?: boolean;
      syncViewportFrameIds?: string[];
      pinHeightFrameIds?: string[];
    },
  ) => void;
  ydoc: Y.Doc | null;
}

export function runRedo({
  activeEditorDragRef,
  activeFile,
  applyFileContentUpdate,
  applyDesignDataHistoryChanges,
  applyGeometryHistoryContentChanges,
  applyLocalContentUpdate,
  canEditDesign,
  allowPendingLiveEdits,
  clipboardPasteRedoStackRef,
  clipboardPasteUndoStackRef,
  codeLayerOwnerByNodeIdRef,
  contentHistorySelectionAfterRef,
  contentRedoSelectionStackRef,
  contentRedoStackRef,
  contentUndoSelectionStackRef,
  contentUndoStackRef,
  createFileMutation,
  deleteFileMutation,
  deleteRuntimeElement,
  designDataJsonRef,
  fileCreationRedoStackRef,
  fileCreationUndoStackRef,
  fileDeletionRedoStackRef,
  fileDeletionUndoStackRef,
  fileHistoryMutationPendingRef,
  clearPendingHistory,
  files,
  filesRef,
  focusCreatedScreen,
  geometryRedoStackRef,
  geometryUndoStackRef,
  getFreshActiveContent,
  getScreenContent,
  historyOrderRef,
  id,
  isSynced,
  lastLocalContentRef,
  resetGeometryCommitCoalescing,
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
  pendingStructureRedoPreparedEditsRef,
  pendingVisualStyleEditsRef,
  pendingVisualStyleRedoStackRef,
  pendingVisualStyleUndoStackRef,
  replayPendingVisualStyleRuntime,
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
  selectionRedoStackRef,
  selectionUndoStackRef,
  setContentRenderRevision,
  setHoveredElement,
  setPendingLayerNameReplayRequest,
  setPendingLayerStateReplayRequest,
  setPendingLiveNonStyleEdits,
  setPendingTextRevertRequest,
  setPendingVisualStyleBaselineResetRequest,
  setPendingVisualStyleEdits,
  setPendingVisualStyleRevertRequest,
  setOverviewSelectedScreenIds,
  setRuntimeStructureInsertRequest,
  setRuntimeStructureDeleteRequest,
  setRuntimeStructureMoveRequest,
  setSelectedElement,
  setSelectedLayerIdsState,
  suppressContentHistoryRef,
  syncLiveScreenSnapshotPreview,
  syncUndoRedoState,
  t,
  undoManagerRef,
  updateLiveScreenSnapshotContent,
  updateDesignAsync,
  viewModeRef,
  writeFrameGeometrySnapshot,
  ydoc,
}: RedoArgs) {
  const restoreHistorySelection = (
    selection: GeometryHistorySelection | undefined,
    replaySources: Record<string, string> = {},
  ) => {
    const currentFiles = filesRef?.current ?? files;
    const actualSources = Object.fromEntries(
      currentFiles.map((file) => [
        file.id,
        replaySources[file.id] ?? getScreenContent(file.id),
      ]),
    );
    const resolved = resolveHistorySelection(
      selection,
      actualSources,
      replaySources,
    );
    restoreSelectionSnapshot(resolved.selection);
    if (selection) setSelectedElement(resolved.element);
  };
  trace("history", "redo", {});
  if (!canEditDesign && !allowPendingLiveEdits) return;
  // U10: see the matching guard in handleUndo — don't redo into a document
  // state an in-progress, uncommitted drag is about to overwrite anyway.
  if (activeEditorDragRef.current) return;
  if (fileHistoryMutationPendingRef.current) return;
  resetGeometryCommitCoalescing?.();
  const pendingNonStyleRedoStack = pendingLiveNonStyleRedoStackRef.current;
  const pendingNonStyleRedo =
    pendingNonStyleRedoStack[pendingNonStyleRedoStack.length - 1];
  const pendingLiveRedoStack = pendingVisualStyleRedoStackRef.current;
  const pendingLiveRedo = pendingLiveRedoStack[pendingLiveRedoStack.length - 1];
  const redoHistoryKind = redoOrderRef.current[redoOrderRef.current.length - 1];
  const pendingRedoKind =
    redoHistoryKind === "pending-style" || redoHistoryKind === "pending-live"
      ? redoHistoryKind
      : undefined;
  if (!canEditDesign && !pendingLiveRedo && !pendingNonStyleRedo) return;
  if (
    (pendingRedoKind === "pending-style" && !pendingLiveRedo) ||
    (pendingRedoKind === "pending-live" && !pendingNonStyleRedo)
  ) {
    return;
  }
  const consumePendingRedoOrder = (kind: "pending-style" | "pending-live") => {
    if (redoOrderRef.current[redoOrderRef.current.length - 1] !== kind) {
      return;
    }
    redoOrderRef.current = redoOrderRef.current.slice(0, -1);
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      kind,
    ];
  };
  const redoPendingNonStyleFirst = shouldRedoPendingLiveNonStyleBeforeStyle(
    pendingRedoKind === "pending-style" || redoHistoryKind === undefined
      ? pendingLiveRedo
      : undefined,
    pendingRedoKind === "pending-live" || redoHistoryKind === undefined
      ? pendingNonStyleRedo
      : undefined,
  );
  if (redoPendingNonStyleFirst && pendingNonStyleRedo?.kind === "structure") {
    const replayEdits =
      pendingLiveStructureEditsFromUndoEntry(pendingNonStyleRedo);
    const redoSourceEdit =
      pendingLiveStructureRedoSourceEdit(pendingNonStyleRedo);
    const redoCommand = pendingStructureRedoCommand(redoSourceEdit);
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
        ...pendingLiveNonStyleUndoStackRef.current,
        pendingNonStyleRedo,
      ];
      consumePendingRedoOrder("pending-live");
      const nextPending = mergePendingLiveNonStyleEdits(
        pendingLiveNonStyleEditsFromUndoStack(
          pendingLiveNonStyleUndoStackRef.current,
        ),
      );
      pendingLiveNonStyleEditsRef.current = nextPending;
      setPendingLiveNonStyleEdits(nextPending);
      syncUndoRedoState();
      return;
    }
    if (pendingStructureRedoReplayRef.current) return;
    pendingStructureRedoReplayRef.current = pendingNonStyleRedo;
    if (redoCommand.kind === "insert") {
      const insertEdit =
        replayEdits.find((edit) => edit.insertedHtml) ??
        pendingNonStyleRedo.edit;
      const pairedDeleteEdit = replayEdits.find(
        (edit) =>
          edit.removed === true &&
          edit.screenId !== insertEdit.screenId &&
          edit.transactionId === insertEdit.transactionId,
      );
      const transactionId = insertEdit.transactionId;
      runtimeStructureInsertRevisionRef.current += 1;
      setRuntimeStructureInsertRequest({
        requestId: runtimeStructureInsertRevisionRef.current,
        transactionId,
        screenId: insertEdit.screenId,
        sourceScreenId: pairedDeleteEdit?.screenId,
        html: redoCommand.html,
        replaceAnchor: redoCommand.replaceAnchor,
        remintCollidingNodeIds: redoCommand.remintCollidingNodeIds,
        anchor: {
          selector: insertEdit.anchorSelector,
          sourceId: insertEdit.anchorSourceId ?? undefined,
        },
        placement: insertEdit.placement,
      });
      if (
        pairedDeleteEdit &&
        transactionId &&
        setRuntimeStructureDeleteRequest
      ) {
        setRuntimeStructureDeleteRequest({
          requestId: `${transactionId}:source:redo-${runtimeStructureInsertRevisionRef.current}`,
          transactionId,
          screenId: pairedDeleteEdit.screenId,
          selector: pairedDeleteEdit.selector,
          selectorCandidates: [pairedDeleteEdit.selector],
          waitForInsertTransaction: true,
          rollbackScreenId: insertEdit.screenId,
        });
      }
      if (pendingStructureRedoReplayTimerRef.current !== undefined) {
        window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      }
      pendingStructureRedoReplayTimerRef.current = window.setTimeout(() => {
        pendingStructureRedoReplayRef.current = undefined;
        if (pendingStructureRedoPreparedEditsRef) {
          pendingStructureRedoPreparedEditsRef.current = undefined;
        }
        pendingStructureRedoReplayTimerRef.current = undefined;
        syncUndoRedoState();
      }, 1_000);
      syncUndoRedoState();
      return;
    }
    runtimeStructureMoveRevisionRef.current += 1;
    const firstReplayEdit = replayEdits[0] ?? pendingNonStyleRedo.edit;
    setRuntimeStructureMoveRequest({
      requestId: runtimeStructureMoveRevisionRef.current,
      screenId: firstReplayEdit.screenId,
      subject: {
        selector: firstReplayEdit.selector,
        sourceId: firstReplayEdit.sourceId ?? undefined,
      },
      anchor: {
        selector: firstReplayEdit.anchorSelector,
        sourceId: firstReplayEdit.anchorSourceId ?? undefined,
      },
      placement: firstReplayEdit.placement,
      transactionId: firstReplayEdit.transactionId,
      gridPlacement: firstReplayEdit.gridPlacement,
      gridDisplacements: firstReplayEdit.gridDisplacements,
      moves:
        replayEdits.length > 1
          ? replayEdits.map((edit) => ({
              subject: {
                selector: edit.selector,
                sourceId: edit.sourceId ?? undefined,
              },
              anchor: {
                selector: edit.anchorSelector,
                sourceId: edit.anchorSourceId ?? undefined,
              },
              placement: edit.placement,
              transactionId: edit.transactionId,
              gridPlacement: edit.gridPlacement,
              gridDisplacements: edit.gridDisplacements,
            }))
          : undefined,
    });
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
    }
    pendingStructureRedoReplayTimerRef.current = window.setTimeout(() => {
      pendingStructureRedoReplayRef.current = undefined;
      if (pendingStructureRedoPreparedEditsRef) {
        pendingStructureRedoPreparedEditsRef.current = undefined;
      }
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
      ...pendingLiveNonStyleUndoStackRef.current,
      pendingNonStyleRedo,
    ];
    const nextPending = mergePendingLiveNonStyleEdits(
      pendingLiveNonStyleEditsFromUndoStack(
        pendingLiveNonStyleUndoStackRef.current,
      ),
    );
    consumePendingRedoOrder("pending-live");
    pendingLiveNonStyleEditsRef.current = nextPending;
    setPendingLayerStateReplayRequest({
      requestId: Date.now() + Math.random(),
      patches: [
        {
          screenId: pendingNonStyleRedo.edit.screenId,
          layerId: pendingNonStyleRedo.edit.layerId,
          state: pendingNonStyleRedo.edit.state,
          enabled: pendingNonStyleRedo.edit.enabled,
          routePath: pendingNonStyleRedo.edit.routePath,
        },
      ],
    });
    setPendingLiveNonStyleEdits(nextPending);
    syncUndoRedoState();
    return;
  }
  if (redoPendingNonStyleFirst && pendingNonStyleRedo?.kind === "layer-name") {
    pendingLiveNonStyleRedoStackRef.current = pendingNonStyleRedoStack.slice(
      0,
      -1,
    );
    pendingLiveNonStyleUndoStackRef.current = [
      ...pendingLiveNonStyleUndoStackRef.current,
      pendingNonStyleRedo,
    ];
    const nextPending = mergePendingLiveNonStyleEdits(
      pendingLiveNonStyleEditsFromUndoStack(
        pendingLiveNonStyleUndoStackRef.current,
      ),
    );
    consumePendingRedoOrder("pending-live");
    pendingLiveNonStyleEditsRef.current = nextPending;
    setPendingLayerNameReplayRequest({
      requestId: Date.now() + Math.random(),
      patches: [
        {
          screenId: pendingNonStyleRedo.edit.screenId,
          selector: pendingNonStyleRedo.edit.selector,
          sourceId: pendingNonStyleRedo.edit.sourceId,
          name: pendingNonStyleRedo.edit.name,
          routePath: pendingNonStyleRedo.edit.routePath,
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
      ...pendingLiveNonStyleUndoStackRef.current,
      pendingTextRedo,
    ];
    const nextPending = mergePendingLiveNonStyleEdits(
      pendingLiveNonStyleEditsFromUndoStack(
        pendingLiveNonStyleUndoStackRef.current,
      ),
    );
    consumePendingRedoOrder("pending-live");
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
          routePath: pendingTextRedo.edit.routePath,
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
  if (
    pendingLiveRedo &&
    (pendingRedoKind === "pending-style" || redoHistoryKind === undefined)
  ) {
    const nextRedoStack = pendingLiveRedoStack.slice(0, -1);
    pendingVisualStyleRedoStackRef.current = nextRedoStack;
    pendingVisualStyleUndoStackRef.current = [
      ...pendingVisualStyleUndoStackRef.current,
      pendingLiveRedo,
    ];
    const nextPending = mergePendingVisualStyleEdits(
      pendingVisualStyleEditsFromUndoStack(
        pendingVisualStyleUndoStackRef.current,
      ),
    );
    pendingVisualStyleEditsRef.current = nextPending;
    const redoneTargets = pendingVisualStyleUndoTargets(pendingLiveRedo);
    const redoneStyleTargets = redoneTargets.filter(
      ({ edit }) => Object.keys(edit.styles).length > 0,
    );
    if (replayPendingVisualStyleRuntime) {
      const requestId = replayPendingVisualStyleRuntime(
        redoneStyleTargets.map(({ edit }) => edit),
      );
      if (requestId !== undefined) {
        setPendingVisualStyleBaselineResetRequest?.(requestId);
      }
    } else if (redoneStyleTargets.length > 0) {
      const requestId = Date.now() + Math.random();
      setPendingVisualStyleRevertRequest({
        requestId,
        patches: redoneStyleTargets.map(({ edit }) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          runtimeSelector: edit.runtimeSelector,
          runtimeSourceId: edit.runtimeSourceId,
          routePath: edit.routePath,
          styles: edit.styles,
          interactionState: edit.interactionState,
        })),
      });
      setPendingVisualStyleBaselineResetRequest?.(requestId);
    }
    setPendingVisualStyleEdits(nextPending);
    // Keep the inspector cache in sync with the replay request. Runtime
    // messages are asynchronous, so this is intentionally optimistic just
    // like the forward live-style path.
    setSelectedElement((prev) => {
      if (!prev) return prev;
      const redoneTarget = redoneTargets.find(
        ({ edit }) =>
          edit.screenId === activeFile?.id &&
          pendingEditTargetsSelectedElement({
            editSourceId: edit.sourceId,
            editSelector: edit.selector,
            selectedSourceId: prev.sourceId,
            selectedSelector: prev.selector,
          }),
      );
      if (!redoneTarget) return prev;
      return {
        ...prev,
        computedStyles: {
          ...prev.computedStyles,
          ...redoneTarget.edit.styles,
        },
      };
    });
    consumePendingRedoOrder("pending-style");
    syncUndoRedoState();
    return;
  }
  const redoClipboardPaste = () => {
    if (
      redoOrderRef.current[redoOrderRef.current.length - 1] !==
      "clipboard-paste"
    ) {
      return false;
    }
    const clipboardPasteRedo =
      clipboardPasteRedoStackRef.current[
        clipboardPasteRedoStackRef.current.length - 1
      ];
    if (!clipboardPasteRedo) return false;
    const currentContent =
      pendingLocalFileContentsRef.current.get(clipboardPasteRedo.fileId)
        ?.content ??
      (clipboardPasteRedo.fileId === activeFile?.id
        ? getFreshActiveContent()
        : (getScreenContent(clipboardPasteRedo.fileId) ?? ""));
    if (currentContent !== clipboardPasteRedo.before) return false;
    if (isShaderWriteInFlight(clipboardPasteRedo.fileId)) {
      toast.error(t("designEditor.toasts.saveConflict"), {
        id: `design-source-shader-conflict:${clipboardPasteRedo.fileId}`,
      });
      return false;
    }
    const clipboardMutation = publishAuthoritativeClipboardMutation({
      fileId: clipboardPasteRedo.fileId,
      baseContent: clipboardPasteRedo.before,
      nextContent: clipboardPasteRedo.after,
      origin: "clipboard-redo",
      baseSource: "document",
    });
    if (!clipboardMutation) return false;
    const writeResult =
      clipboardPasteRedo.fileId === activeFile?.id
        ? applyLocalContentUpdate(clipboardPasteRedo.after, {
            recordHistory: false,
            forcePreviewFullDocument: true,
            immediateSave: true,
            clipboardMutation,
          })
        : applyFileContentUpdate(
            clipboardPasteRedo.fileId,
            clipboardPasteRedo.after,
            {
              recordHistory: false,
              forcePreviewFullDocument: true,
              clipboardMutation,
            },
          );
    if (writeResult.status !== "accepted") return false;
    clipboardPasteRedoStackRef.current =
      clipboardPasteRedoStackRef.current.slice(0, -1);
    clipboardPasteUndoStackRef.current = [
      ...clipboardPasteUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      clipboardPasteRedo,
    ];
    redoOrderRef.current = redoOrderRef.current.slice(0, -1);
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "clipboard-paste",
    ];
    return true;
  };
  const um = undoManagerRef.current;
  const canUseOverviewHistory = viewModeRef.current === "overview";
  let prunedRedoHistory = 0;
  let contentReplayRefused = false;
  const redoContent = (scope: "any" | "local" | "global" = "any") => {
    if (scope !== "global" && um?.canRedo()) {
      const beforeRedoContent = ydoc?.getText("content").toJSON();
      const redoneItem = um.redo();
      // Figma parity: redo re-selects whatever the original gesture left
      // selected (the new group, the pasted copy, the duplicate) — see the
      // matching note on the geometry branch below and
      // stampYjsUndoSelectionAfter's doc comment. Overrides the
      // refresh-from-content heuristic, which can only ever keep or drop
      // whatever is CURRENTLY selected and has no way to reach forward to a
      // node that didn't exist until this redo created it.
      const restoredAfterSelection = readYjsRedoSelection(redoneItem);
      if (ydoc && activeFile && beforeRedoContent !== undefined) {
        const ytext = ydoc.getText("content");
        const rawNext = ytext.toJSON();
        let next = rawNext;
        try {
          next = prepareCanonicalSourceContent(rawNext, {
            fileId: activeFile.id,
            fileType: activeFile.fileType,
          }).content;
        } catch {
          toast.error(t("common.genericError"), {
            id: `design-source-identity:${activeFile.id}`,
          });
          return false;
        }
        if (next !== rawNext) writeCollabText(ydoc, ytext, next, TAB_ID);
        markPendingLocalFileContent(activeFile.id, next, activeFile.updatedAt);
        lastLocalContentRef.current = next;
        queueFileContentSave(activeFile.id, next, {
          expectedVersionHash: sourceContentHash(beforeRedoContent),
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
          if (restoredAfterSelection)
            return resolveLocalHistorySelection(
              restoredAfterSelection,
              activeFile.id,
              next,
            ).selectedElement;
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev, {
            kind: "design-file",
            fileId: activeFile.id,
          });
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev, {
            kind: "design-file",
            fileId: activeFile.id,
          });
        });
        // U18: keep the layers-panel highlight in sync too.
        setSelectedLayerIdsState((prev) =>
          restoredAfterSelection
            ? resolveLocalHistorySelection(
                restoredAfterSelection,
                activeFile.id,
                next,
              ).selectedLayerIds
            : refreshSelectedLayerIdsFromContent(next, prev, {
                kind: "design-file",
                fileId: activeFile.id,
              }),
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
          historyOrderRef.current = [
            ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
            "content",
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
            return refreshElementInfoFromContent(entry.after, prev, {
              kind: "design-file",
              fileId: entry.fileId,
            });
          });
          setHoveredElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.after, prev, {
              kind: "design-file",
              fileId: entry.fileId,
            });
          });
          // U18: keep the layers-panel highlight in sync too.
          setSelectedLayerIdsState((prev) =>
            refreshSelectedLayerIdsFromContent(entry.after, prev, {
              kind: "design-file",
              fileId: entry.fileId,
            }),
          );
          return true;
        }
      }
    }

    if (scope === "local") return false;
    const entry =
      contentRedoStackRef.current[contentRedoStackRef.current.length - 1];
    if (!entry) return false;
    const linkedComponent =
      "linkedComponent" in entry && entry.linkedComponent === true;
    if (!canUseOverviewHistory && !linkedComponent) return false;
    const entrySelection =
      contentRedoSelectionStackRef.current[
        contentRedoSelectionStackRef.current.length - 1
      ];
    // Figma parity: redo re-selects whatever the original gesture left
    // selected (the new group, the pasted copy, the duplicate) when it
    // stamped one — see ContentHistorySelectionAfterMap's doc comment for
    // why this is a lookup by the entry's own object identity rather than a
    // second index-aligned slot, and why it silently falls back to the
    // pre-gesture `entrySelection` (this stack's pre-existing redo
    // behavior) once that identity no longer survives a rebuild.
    const entrySelectionAfter =
      contentHistorySelectionAfterRef.current.get(entry) ?? entrySelection;
    const { available: changes, remainder } = partitionContentHistoryEntry(
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
    const preparedReplay = prepareContentHistoryReplay({
      activeFile,
      changes,
      direction: "redo",
      files,
      getFreshActiveContent,
      getScreenContent,
      liveScreenSnapshotsById,
      t,
    });
    if (!preparedReplay) {
      contentReplayRefused = true;
      return false;
    }
    const acceptedContents = new Map<string, string>();
    let replayAccepted = true;
    suppressContentHistoryRef.current = true;
    try {
      for (const change of changes) {
        if (change.before === change.after) continue;
        // U20: see the matching note in handleUndo — route a live-snapshot
        // screen's replay through updateLiveScreenSnapshotContent instead
        // of the regular content path.
        if (liveScreenSnapshotsById[change.fileId]) {
          acceptedContents.set(change.fileId, change.after);
          updateLiveScreenSnapshotContent(change.fileId, change.after, {
            recordHistory: false,
          });
          syncLiveScreenSnapshotPreview(change.fileId, change.after);
        } else {
          const prepared = preparedReplay.get(change.fileId);
          if (!prepared) {
            replayAccepted = false;
            break;
          }
          const result =
            change.fileId === activeFile?.id
              ? applyLocalContentUpdate(change.after, {
                  historyBeforeContent: prepared.historyBeforeContent,
                  refreshPreview: false,
                  forcePreviewFullDocument: true,
                  immediateSave: true,
                  recordHistory: false,
                })
              : applyFileContentUpdate(change.fileId, change.after, {
                  historyBeforeContent: prepared.historyBeforeContent,
                  recordHistory: false,
                  refreshPreview: false,
                });
          if (result.status !== "accepted") {
            replayAccepted = false;
            break;
          }
          acceptedContents.set(change.fileId, result.content);
        }
      }
    } finally {
      suppressContentHistoryRef.current = false;
    }
    if (!replayAccepted) {
      contentReplayRefused = true;
      return false;
    }
    const replayedChanges = changes.map((change) => {
      const prepared = preparedReplay.get(change.fileId);
      const acceptedContent = acceptedContents.get(change.fileId);
      return prepared && acceptedContent !== undefined
        ? {
            ...change,
            before: prepared.historyBeforeContent,
            after: acceptedContent,
          }
        : change;
    });

    contentRedoStackRef.current.pop();
    contentRedoSelectionStackRef.current.pop();
    const remainderEntry = contentHistoryEntryFromChanges(
      remainder,
      linkedComponent,
    );
    if (remainderEntry) {
      contentRedoStackRef.current.push(remainderEntry);
      contentRedoSelectionStackRef.current.push(entrySelection);
      restoreFileContentHistoryOrderToken(redoOrderRef.current, true);
    }
    const appliedEntry = contentHistoryEntryFromChanges(
      replayedChanges,
      linkedComponent,
    )!;
    const stampedAfter = contentHistorySelectionAfterRef.current.get(entry);
    if (stampedAfter)
      contentHistorySelectionAfterRef.current.set(appliedEntry, stampedAfter);
    contentUndoStackRef.current = [
      ...contentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      appliedEntry,
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
    applyDesignDataHistoryChanges?.(changes, "redo");
    const activeChange = replayedChanges.find(
      (change) =>
        change.fileId === activeFile?.id && change.before !== change.after,
    );
    if (activeChange) {
      setSelectedElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.after, prev, {
          kind: "design-file",
          fileId: activeChange.fileId,
        });
      });
      setHoveredElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.after, prev, {
          kind: "design-file",
          fileId: activeChange.fileId,
        });
      });
      // U18: keep the layers-panel highlight in sync too.
      setSelectedLayerIdsState((prev) =>
        refreshSelectedLayerIdsFromContent(activeChange.after, prev, {
          kind: "design-file",
          fileId: activeChange.fileId,
        }),
      );
    }
    restoreHistorySelection(
      entrySelectionAfter,
      Object.fromEntries(
        replayedChanges.map((change) => [change.fileId, change.after]),
      ),
    );
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
        replacePendingGeometrySave: true,
        syncViewportFrameIds: viewportChangedFrameIds(
          entry.before,
          entry.after,
        ),
      },
    );
    // Figma parity: redo re-selects whatever was selected when this
    // gesture's change was originally made (i.e. the selection AFTER the
    // gesture committed, matching what undo just took away).
    if (entry.linkedContentChanges?.length) {
      applyGeometryHistoryContentChanges?.(entry.linkedContentChanges, "redo");
    }
    restoreHistorySelection(
      entry.selectionAfter,
      Object.fromEntries(
        (entry.linkedContentChanges ?? []).map((change) => [
          change.fileId,
          change.after,
        ]),
      ),
    );
    return true;
  };
  // Figma parity (ground-truth Round 4): redo a plain selection change — see
  // SelectionHistoryEntry's doc comment and undo.ts's undoSelection.
  const redoSelection = () => {
    if (!canUseOverviewHistory) return false;
    const entry = selectionRedoStackRef.current.pop();
    if (!entry) return false;
    selectionUndoStackRef.current = [
      ...selectionUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "selection",
    ];
    restoreHistorySelection(entry.after);
    return true;
  };
  // U12: redo a screen create/duplicate by recreating the file with the
  // same filename/content/fileType and restoring its recorded geometry.
  // This is async (createFileMutation), unlike every other redo path here, so
  // keep history pending until both the file and its metadata persist.
  const redoFileCreation = () => {
    if (!canUseOverviewHistory) return false;
    const redoStack = fileCreationRedoStackRef.current;
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return false;
    if (!id) return false;
    const currentFiles = filesRef?.current ?? files;
    const knownFileIds = new Set(
      entry.recoveryKnownFileIds ??
        captureDesignFileIds({
          queryClient,
          designId: id,
          files: currentFiles,
        }),
    );
    let batchStart = redoStack.length - 1;
    while (
      batchStart > 0 &&
      entry.historyBatchId &&
      redoStack[batchStart - 1]?.historyBatchId === entry.historyBatchId
    ) {
      batchStart -= 1;
    }
    const entries = redoStack.slice(batchStart);
    redoStack.splice(batchStart, entries.length);
    fileCreationUndoStackRef.current = [
      ...fileCreationUndoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - entries.length),
      ),
      ...entries,
    ];
    historyOrderRef.current = [
      ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-created",
    ];
    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
    const attemptedEntries = new Set<FileCreationHistoryEntry>();
    const createdFileIds = new Map<FileCreationHistoryEntry, string>();
    const retryRecoveryFileIds = new Map<
      FileCreationHistoryEntry,
      string | null | undefined
    >();
    const recreatedFileIds: string[] = [];
    const handleFailure = async (error: unknown) => {
      let errorMessage =
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.screenDuplicateError");
      const rollbackFileIds = new Set(
        entries.flatMap((item) =>
          item.recoveryFileId ? [item.recoveryFileId] : [],
        ),
      );
      let rollbackFailed = false;
      for (const [item, createdFileId] of createdFileIds) {
        rollbackFileIds.add(createdFileId);
        try {
          await deleteFileMutation.mutateAsync({
            id: createdFileId,
            allowLockedLayers: true,
          } as any);
        } catch (cleanupError) {
          rollbackFailed = true;
          const cleanupMessage =
            cleanupError instanceof Error
              ? cleanupError.message
              : t("designEditor.toasts.screenDuplicateError");
          errorMessage = `${errorMessage}; cleanup failed: ${cleanupMessage}`;
          const present = await isPersistedFilePresent({
            queryClient,
            designId: id,
            fileId: createdFileId,
          });
          retryRecoveryFileIds.set(
            item,
            present === true ? createdFileId : null,
          );
          if (present !== true) rollbackFileIds.delete(createdFileId);
        }
      }
      for (const rollbackFileId of rollbackFileIds) {
        const nextGeometry = {
          ...getCanvasFrameGeometry(designDataJsonRef.current),
        };
        delete nextGeometry[rollbackFileId];
        writeFrameGeometrySnapshot(nextGeometry, {
          replacePendingGeometrySave: true,
        });
      }
      const duplicateStack = entries.find(
        (item) => item.duplicateStack,
      )?.duplicateStack;
      if (duplicateStack && !rollbackFailed) {
        const restoredGeometry = {
          ...getCanvasFrameGeometry(designDataJsonRef.current),
        };
        for (const [frameId, geometry] of Object.entries(
          duplicateStack.before,
        )) {
          if (geometry) restoredGeometry[frameId] = geometry;
          else delete restoredGeometry[frameId];
        }
        writeFrameGeometrySnapshot(restoredGeometry, {
          replacePendingGeometrySave: true,
        });
      }
      for (const item of attemptedEntries) {
        if (
          !retryRecoveryFileIds.has(item) &&
          item.recoveryFileId === undefined
        ) {
          retryRecoveryFileIds.set(item, null);
        }
      }
      fileCreationUndoStackRef.current =
        fileCreationUndoStackRef.current.filter(
          (item) => !entries.includes(item),
        );
      historyOrderRef.current = removeRecentUndoRedoOrderKinds(
        historyOrderRef.current,
        "file-created",
        1,
      );
      const retryEntries = entries.map((item) => {
        if (!retryRecoveryFileIds.has(item)) return item;
        const recoveryFileId = retryRecoveryFileIds.get(item);
        return {
          ...item,
          recoveryFileId,
          recoveryKnownFileIds: [...knownFileIds],
        };
      });
      fileCreationRedoStackRef.current = [
        ...fileCreationRedoStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - retryEntries.length),
        ),
        ...retryEntries,
      ];
      redoOrderRef.current = [
        ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-created",
      ];
      fileHistoryMutationPendingRef.current = false;
      syncUndoRedoState();
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design"],
      });
      toast.error(errorMessage);
    };
    const createFile = (item: FileCreationHistoryEntry) => {
      const input = {
        designId: id,
        filename: item.filename,
        content: item.content,
        fileType: item.fileType,
      } as any;
      if (typeof createFileMutation.mutateAsync === "function")
        return createFileMutation.mutateAsync(input);
      return new Promise((resolve, reject) => {
        createFileMutation.mutate(input, {
          onSuccess: async (result: unknown) => resolve(result),
          onError: reject,
        });
      });
    };
    const recreateFile = async (item: FileCreationHistoryEntry) => {
      attemptedEntries.add(item);
      const recoveryFileId = item.recoveryFileId;
      let rawResult: unknown;
      let reusedRecovery = false;
      if (recoveryFileId !== undefined && recoveryFileId !== null) {
        const present = await isPersistedFilePresent({
          queryClient,
          designId: id,
          fileId: recoveryFileId,
        });
        if (present === true) {
          rawResult = { id: recoveryFileId };
          reusedRecovery = true;
        } else if (present === false) {
          retryRecoveryFileIds.set(item, undefined);
          rawResult = await createFile(item);
        } else {
          throw new Error(
            `Unable to verify recovered file "${item.filename}" before retrying`,
          );
        }
      } else {
        const reconciled = await reconcileCreatedFile({
          queryClient,
          designId: id,
          filename: item.filename,
          content: item.content,
          fileType: item.fileType as DesignFile["fileType"],
          files: currentFiles,
          knownFileIds,
        });
        rawResult = reconciled ?? (await createFile(item));
      }
      let result = rawResult;
      let nextId = createdFileIdFromResult(result);
      if (!nextId) {
        retryRecoveryFileIds.set(item, null);
        const reconciled = await reconcileCreatedFile({
          queryClient,
          designId: id,
          filename: item.filename,
          content: item.content,
          fileType: item.fileType as DesignFile["fileType"],
          files: currentFiles,
          knownFileIds,
        });
        if (reconciled) {
          result = reconciled;
          nextId = reconciled.id;
        }
      }
      if (!nextId) {
        throw new Error(
          `Failed to recreate "${item.filename}": create-file returned no id and no persisted file could be reconciled`,
        );
      }
      if (!reusedRecovery) createdFileIds.set(item, nextId);
      const geometry = {
        ...getInitialFrameGeometry(overviewScreens.length, {
          width: 1280,
          height: 2560,
        }),
        ...item.geometry,
      };
      const dataOperations: DesignDataOperation[] = [
        ...Object.entries(item.duplicateStack?.after ?? {}).map(
          ([frameId, stackGeometry]) => ({
            op: "set" as const,
            path: ["canvasFrames", frameId] as [string, ...string[]],
            value: stackGeometry,
          }),
        ),
        {
          op: "set",
          path: ["canvasFrames", nextId],
          value: geometry,
        },
        ...(item.screenMetadata
          ? [
              {
                op: "set" as const,
                path: ["screenMetadata", nextId] as [string, ...string[]],
                value: item.screenMetadata,
              },
            ]
          : []),
        ...(item.localhostScreen
          ? [
              {
                op: "set" as const,
                path: ["localhostScreens", nextId] as [string, ...string[]],
                value: item.localhostScreen,
              },
            ]
          : []),
      ];
      if (dataOperations.length > 0) {
        const nextData = applyDesignDataOperations(
          designDataJsonRef.current,
          dataOperations,
        );
        designDataJsonRef.current = nextData;
        queryClient.setQueryData(
          ["action", "get-design", { id }],
          (old: any) => {
            if (!old || typeof old !== "object") return old;
            return { ...old, data: JSON.stringify(nextData) };
          },
        );
        await updateDesignAsync({ id, dataOperations } as any);
      }
      writeFrameGeometrySnapshot({
        ...getCanvasFrameGeometry(designDataJsonRef.current),
        ...(item.duplicateStack?.after ?? {}),
        [nextId]: geometry,
      });
      optimisticallyInsertCreatedFile({
        fileId: nextId,
        filename: item.filename,
        fileType: item.fileType,
        content: item.content,
        result: result as Record<string, unknown> | null | undefined,
      });
      focusCreatedScreen(nextId, geometry, {
        preserveCamera: item.preserveCamera,
        suppressLineupRecenter: item.preserveCamera,
      });
      recreatedFileIds.push(nextId);
    };
    void (async () => {
      try {
        for (const item of entries) await recreateFile(item);
        if (entries.length > 1) {
          setOverviewSelectedScreenIds(recreatedFileIds);
        }
        fileCreationUndoStackRef.current = fileCreationUndoStackRef.current.map(
          (item) => {
            if (!entries.includes(item) || item.recoveryFileId === undefined)
              return item;
            const committedEntry = { ...item };
            delete committedEntry.recoveryFileId;
            delete committedEntry.recoveryKnownFileIds;
            return committedEntry;
          },
        );
        fileHistoryMutationPendingRef.current = false;
        syncUndoRedoState();
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      } catch (error) {
        await handleFailure(error);
      }
    })();
    return true;
  };
  const redoFileDeletion = () => {
    if (!canUseOverviewHistory) return false;
    const entry = fileDeletionRedoStackRef.current.pop();
    if (!entry) return false;

    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
    const currentEntry = {
      ...entry,
      files: entry.files.map((file) => ({
        ...file,
        content: getScreenContent(file.id),
      })),
    };
    performDeleteFiles(currentEntry.files, {
      preserveHistory: true,
      onMutationSettled: (deletedFiles, failedFiles, deletedFileSnapshots) => {
        if (deletedFiles.length > 0) {
          const deletedIds = new Set(deletedFiles.map((file) => file.id));
          const authoritativeSnapshots = (deletedFileSnapshots ?? []).filter(
            (file) => deletedIds.has(file.id),
          );
          if (authoritativeSnapshots.length === deletedFiles.length) {
            fileDeletionUndoStackRef.current = [
              ...fileDeletionUndoStackRef.current.slice(
                -(MAX_DESIGN_UNDO_STACK - 1),
              ),
              filterFileDeletionHistoryEntry(
                { files: authoritativeSnapshots },
                deletedIds,
              ),
            ];
            historyOrderRef.current = [
              ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
              "file-deleted",
            ];
          } else {
            toast.error(t("common.genericError"));
          }
          clearPendingHistory?.();
        }
        if (failedFiles.length > 0) {
          const failedIds = new Set(failedFiles.map((file) => file.id));
          fileDeletionRedoStackRef.current = [
            ...fileDeletionRedoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            filterFileDeletionHistoryEntry(currentEntry, failedIds),
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

  const tryRedoActions = (...actions: Array<() => boolean>) => {
    for (const action of actions) {
      if (action()) return true;
      if (contentReplayRefused) return false;
    }
    return false;
  };
  const redoByOrder = (preferred?: UndoRedoOrderKind | "selection") => {
    if (preferred === "clipboard-paste") return redoClipboardPaste();
    if (preferred === "selection") {
      return tryRedoActions(redoSelection, redoContent, redoGeometry);
    }
    if (preferred === "file-deleted") {
      return tryRedoActions(
        redoFileDeletion,
        redoFileCreation,
        redoContent,
        redoGeometry,
      );
    }
    if (preferred === "file-created")
      return tryRedoActions(
        redoFileCreation,
        redoFileDeletion,
        redoContent,
        redoGeometry,
      );
    if (preferred === "geometry")
      return tryRedoActions(redoGeometry, redoContent);
    if (preferred === "file-content") {
      const prunedBefore = prunedRedoHistory;
      if (redoContent("global")) return true;
      if (contentReplayRefused || prunedRedoHistory > prunedBefore)
        return false;
      return redoGeometry();
    }
    if (preferred === "content") {
      const prunedBefore = prunedRedoHistory;
      if (redoContent("local")) return true;
      if (contentReplayRefused) return false;
      if (redoContent("global")) return true;
      if (contentReplayRefused || prunedRedoHistory > prunedBefore)
        return false;
      return redoGeometry();
    }
    return tryRedoActions(redoFileDeletion, redoContent, redoGeometry);
  };
  let didRedo = false;
  if (canUseOverviewHistory) {
    while (!didRedo) {
      const preferred = redoOrderRef.current[redoOrderRef.current.length - 1];
      if (preferred !== "clipboard-paste") redoOrderRef.current.pop();
      if (
        preferred === "file-created" &&
        !id &&
        fileCreationRedoStackRef.current.length > 0
      ) {
        redoOrderRef.current.push(preferred);
        break;
      }
      didRedo = redoByOrder(preferred);
      if (contentReplayRefused) {
        if (preferred !== undefined && preferred !== "clipboard-paste")
          redoOrderRef.current.push(preferred);
        break;
      }
      if (didRedo) {
        // Figma parity (ground-truth Round 4, Part B): redoing a real edit
        // consumes any selection-only step still sitting above it on the
        // redo ledger instead of replaying it — undo walked back through
        // that trailing selection change, but redo does not reconstruct it.
        // `preferred` can only route to redoSelection() when it is exactly
        // "selection" (see redoByOrder above), so anything else here means a
        // real edit was what just redid.
        if (preferred !== "selection") {
          while (
            redoOrderRef.current[redoOrderRef.current.length - 1] ===
            "selection"
          ) {
            redoOrderRef.current.pop();
            selectionRedoStackRef.current.pop();
          }
        }
        break;
      }
      if (preferred === "clipboard-paste" || preferred === undefined) break;
    }
  } else {
    const preferred = redoOrderRef.current[redoOrderRef.current.length - 1];
    const linkedEntry =
      contentRedoStackRef.current[contentRedoStackRef.current.length - 1];
    const canRedoLinkedEntry =
      !!linkedEntry &&
      "linkedComponent" in linkedEntry &&
      linkedEntry.linkedComponent === true;
    if (preferred === "clipboard-paste") {
      didRedo = redoClipboardPaste();
    } else if (preferred === "file-content" && canRedoLinkedEntry) {
      redoOrderRef.current.pop();
      didRedo = redoContent("global");
      if (!didRedo && prunedRedoHistory === 0)
        redoOrderRef.current.push(preferred);
    } else if (preferred === "content") {
      redoOrderRef.current.pop();
      didRedo = redoContent("local");
      if (!didRedo) redoOrderRef.current.push(preferred);
    } else if (preferred === undefined) {
      didRedo = redoContent("local");
    }
  }
  if (didRedo || prunedRedoHistory > 0) {
    syncUndoRedoState();
  }
}

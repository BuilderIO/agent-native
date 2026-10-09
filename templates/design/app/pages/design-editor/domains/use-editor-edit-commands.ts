import type { MotionAnimationClip } from "@shared/motion-timeline";
import {
  copyLayerAnimation,
  pasteLayerAnimation,
} from "@shared/motion-timeline";
import { isRunningAppSourceType } from "@shared/source-mode";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

import { type MotionDockTrack } from "@/components/design/MotionDock";
import { resolveScreenHeightMode } from "@/components/design/multi-screen/screen-height";
import type {
  RuntimeLayerRenameRequest,
  RuntimeStructureMoveRequest,
} from "@/components/design/types";

import {
  bridgeSourceIdForCodeLayerNode,
  findCodeLayerSiblingOrder,
  preferredCodeLayerSelector,
} from "../code-layer-state";
import { runChangeSelectedZIndex } from "../commands/change-selected-z-index";
import { releaseCrossScreenDropAdmission } from "../commands/cross-screen-element-drop";
import {
  cancelCrossScreenRollbackTimeout,
  crossScreenRollbackIsComplete,
  crossScreenRollbackDisposition,
  crossScreenSourceDeleteCancellation,
  retryCrossScreenRollbackRequest,
  scheduleCrossScreenRollbackTimeout,
} from "../commands/cross-screen-insert-timeout";
import { runDeleteFiles } from "../commands/delete-files";
import { runNudgeSelection } from "../commands/nudge-selection";
import { runRedo } from "../commands/redo";
import { runUndo } from "../commands/undo";
import { applyDesignDataOperations } from "../data-operations";
import { getDesignDataRecord } from "../design-data-geometry-utils";
import { type UndoRedoOrderKind } from "../editor-state";
import {
  type ContentHistoryChange,
  type FileDeletionHistorySnapshot,
} from "../history";
import {
  pendingLiveStructureEditsFromEdit,
  pendingLiveStructureEditsFromUndoEntry,
} from "../pending-edits";
import { overviewSelectionTargetsElement } from "../selection-state";
import { type DesignFile } from "../types";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorClipboard } from "./use-editor-clipboard";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLayoutAndStructure } from "./use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorScreenChangeHandlers } from "./use-editor-screen-change-handlers";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorEditCommands({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorToolsAndVectors,
  editorSelectionAndStyles,
  editorScreenChangeHandlers,
  editorClipboard,
  editorLayoutAndStructure,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorToolsAndVectors: EditorToolsAndVectors;
  editorSelectionAndStyles: EditorSelectionAndStyles;
  editorScreenChangeHandlers: EditorScreenChangeHandlers;
  editorClipboard: EditorClipboard;
  editorLayoutAndStructure: EditorLayoutAndStructure;
}) {
  const {
    t,
    id,
    queryClient,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    setPendingVisualStyleRevertRequest,
    setPendingTextRevertRequest,
    setPendingLayerStateReplayRequest,
    pendingLayerNameReplayRequest,
    setPendingLayerNameReplayRequest,
    runtimeStructurePendingTransactionRef,
    setRuntimeStructureInsertRequest,
    liveRoutePathsByScreenIdRef,
    setPendingVisualStyleBaselineResetRequest,
    pendingStructureRedoReplayTimerRef,
    requestPendingVisualStyleRevert,
    replayPendingVisualStyleRuntime,
    requestPendingLiveNonStyleRevert,
    setHoveredElement,
    setActiveFileId,
  } = editorCore;
  const {
    setPendingVisualStyleEdits,
    setPendingLiveNonStyleEdits,
    pendingVisualStyleEditsRef,
    pendingLiveNonStyleEditsRef,
    pendingVisualStyleUndoStackRef,
    pendingVisualStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingLiveNonStyleRedoStackRef,
    pendingStructureRedoReplayRef,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    renderedElementInfoByLayerKeyRef,
    invalidateRenderedElementInfo,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    latestClipboardMutationContentRef,
    clipboardPasteUndoStackRef,
    clipboardPasteRedoStackRef,
    activeBreakpointWidthStateRef,
    undoManagerRef,
    contentUndoStackRef,
    contentRedoStackRef,
    contentUndoSelectionStackRef,
    contentRedoSelectionStackRef,
    localContentUndoStackRef,
    localContentRedoStackRef,
    geometryUndoStackRef,
    geometryRedoStackRef,
    explicitOverviewScreenSelectionRef,
    fileCreationUndoStackRef,
    fileCreationRedoStackRef,
    fileDeletionUndoStackRef,
    fileDeletionRedoStackRef,
    fileHistoryMutationPendingRef,
    historyOrderRef,
    redoOrderRef,
    selectionUndoStackRef,
    selectionRedoStackRef,
    clearRedoStacks,
    clearPendingHistoryDirections,
    syncUndoRedoState,
    recordLocalContentHistoryChangeFallback,
    flushPendingFileCreationHistoryEntries,
    discardPendingLiveStructureTransaction,
  } = editorHistory;
  const {
    restoreSelectionSnapshot,
    resetGeometryCommitCoalescing,
    canEditDesign,
    canEditLiveScreens,
    rawServerFilesByIdRef,
    historyFilesRef,
    pendingLocalFileContentsRef,
    markPendingLocalFileContent,
    createFileMutation,
    deleteFileMutation,
    updateDesignAsync,
    publishAuthoritativeClipboardMutation,
  } = editorGenerationAndAccess;
  const {
    locallyPinnedHeightIdsRef,
    queueFileContentSave,
    editorPreferences,
    files,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    designDataJsonRef,
    canvasFrameGeometryById,
    liveFrameGeometryRef,
    boardFileId,
    overviewScreens,
    updateLiveScreenSnapshotContent,
  } = editorFilesAndSaving;
  const {
    responsiveEditScopeRef,
    applyGeometryHistoryContentChangesRef,
    enqueueFrameGeometryDataSave,
    writeFrameGeometrySnapshot,
    handleGeometryCommit,
    activeFile,
    activeBreakpointUpperBoundPx,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const {
    optimisticallyInsertCreatedFile,
    focusCreatedScreen,
    ydoc,
    isSynced,
    lastLocalContentRef,
    activeEditorDragRef,
    canvasIframeRef,
    getScreenContent,
    recordPendingLiveLayerNameEdit,
  } = editorCanvasAndScreens;
  const {
    setContentRenderRevision,
    motionTracks,
    setMotionTracks,
    selectedMotionTargetNodeId,
    canEditLiveScreen,
    replacePreviewContent,
    syncLiveScreenSnapshotPreview,
    deleteRuntimeElement,
  } = editorLiveEditsAndPresence;
  const {
    contentHistorySelectionAfterRef,
    suppressContentHistoryRef,
    markMotionTracksDirty,
    applyLocalContentUpdate,
    applyFileContentUpdate,
  } = editorContentAndComponents;
  const { runtimeStructureInsertRevisionRef, selectionRevisionRef } =
    editorToolsAndVectors;
  const {
    selectedLayerTargetsRef,
    canEditActiveVisualScreen,
    applyLinkedComponentEdit,
    commitVisualStyles,
    getFreshActiveContent,
    handleStyleChange,
    handleStylesChange,
  } = editorSelectionAndStyles;
  const {
    pendingStructureRedoPreparedEditsRef,
    recordPendingLiveStructureEdit,
  } = editorScreenChangeHandlers;
  const { handleDeleteSelection } = editorClipboard;
  const {
    runtimeStructureDeleteRequest,
    setRuntimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
    setRuntimeStructureRollbackRequest,
    runtimeStructureRollbackRevisionRef,
    boardFrameGeometry,
  } = editorLayoutAndStructure;

  const [runtimeStructureMoveRequest, setRuntimeStructureMoveRequest] =
    useState<(RuntimeStructureMoveRequest & { screenId: string }) | null>(null);
  const runtimeStructureMoveRevisionRef = useRef(0);
  const runtimeStructureRollbackTimeoutCancelRef = useRef<(() => void) | null>(
    null,
  );
  const [runtimeLayerRenameRequest, setRuntimeLayerRenameRequest] = useState<
    (RuntimeLayerRenameRequest & { screenId: string; layerId: string }) | null
  >(null);
  const [hasPropsClipboard, setHasPropsClipboard] = useState(false);
  const copiedLayerAnimationRef = useRef<MotionAnimationClip | null>(null);
  const [hasAnimationClipboard, setHasAnimationClipboard] = useState(false);
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  const handleRuntimeStructureRollbackResult = useCallback(
    (details: {
      requestId: string;
      transactionId?: string;
      applied: boolean;
      reason?: string;
    }) => {
      if (runtimeStructureRollbackRequest?.requestId !== details.requestId) {
        return;
      }
      cancelCrossScreenRollbackTimeout(
        runtimeStructureRollbackTimeoutCancelRef,
      );
      const rollbackRequest = runtimeStructureRollbackRequest;
      const transactionId = rollbackRequest.transactionId;
      const sourceCancellationAlreadyPending = Boolean(
        transactionId &&
        runtimeStructureDeleteRequest?.transactionId === transactionId &&
        runtimeStructureDeleteRequest.cancelRequested,
      );
      const destinationScreenExists =
        rollbackRequest.screenId === boardFileId ||
        overviewScreens.some(
          (screen) => screen.id === rollbackRequest.screenId,
        );
      if (
        details.reason === "rollback-timeout" &&
        transactionId &&
        destinationScreenExists &&
        !sourceCancellationAlreadyPending
      ) {
        const retryRevision = runtimeStructureRollbackRevisionRef.current + 1;
        const retryRequest = retryCrossScreenRollbackRequest(
          rollbackRequest,
          `${transactionId}:rollback:${retryRevision}`,
        );
        if (retryRequest) {
          runtimeStructureRollbackRevisionRef.current = retryRevision;
          setRuntimeStructureRollbackRequest((current) =>
            current?.requestId === rollbackRequest.requestId
              ? retryRequest
              : current,
          );
          return;
        }
        setRuntimeStructureRollbackRequest((current) =>
          current?.requestId === rollbackRequest.requestId ? null : current,
        );
      }
      const hasPendingInsert = Boolean(
        transactionId &&
        (pendingLiveNonStyleEditsRef.current.some(
          (edit) =>
            edit.kind === "structure" &&
            pendingLiveStructureEditsFromEdit(edit).some(
              (member) =>
                member.transactionId === transactionId &&
                Boolean(member.insertedHtml),
            ),
        ) ||
          pendingLiveNonStyleUndoStackRef.current.some(
            (entry) =>
              entry.kind === "structure" &&
              pendingLiveStructureEditsFromUndoEntry(entry).some(
                (member) =>
                  member.transactionId === transactionId &&
                  Boolean(member.insertedHtml),
              ),
          )),
      );
      const rollbackIsComplete = crossScreenRollbackIsComplete(
        rollbackRequest,
        details,
      );
      const disposition = crossScreenRollbackDisposition({
        applied: rollbackIsComplete,
        destinationHasPendingInsert: hasPendingInsert,
        destinationScreenExists,
      });
      const pendingSourceDelete =
        transactionId &&
        runtimeStructureDeleteRequest?.transactionId === transactionId
          ? runtimeStructureDeleteRequest
          : null;
      const pendingSourceCancellation =
        transactionId && pendingSourceDelete
          ? crossScreenSourceDeleteCancellation(
              pendingSourceDelete,
              transactionId,
            )
          : null;
      setRuntimeStructureRollbackRequest((current) =>
        current?.requestId === rollbackRequest.requestId ? null : current,
      );
      if (pendingSourceCancellation) {
        setRuntimeStructureInsertRequest((current) =>
          current?.transactionId === transactionId ? null : current,
        );
        if (disposition === "discard") {
          if (transactionId) {
            discardPendingLiveStructureTransaction(transactionId);
          }
        }
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === transactionId
            ? pendingSourceCancellation
            : current,
        );
        if (!rollbackIsComplete) {
          toast.error(t("designEditor.toasts.layerMoveFailed"), {
            duration: 4000,
          });
        }
        return;
      }
      if (disposition === "retain-recovery") {
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          transactionId,
        );
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return;
      }
      if (transactionId && disposition === "discard") {
        discardPendingLiveStructureTransaction(transactionId);
      }
      releaseCrossScreenDropAdmission(
        runtimeStructurePendingTransactionRef,
        transactionId,
      );
      if (transactionId) {
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === transactionId ? null : current,
        );
      }
      if (!rollbackIsComplete) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
      }
    },
    [
      discardPendingLiveStructureTransaction,
      runtimeStructureRollbackRequest,
      runtimeStructurePendingTransactionRef,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureInsertRequest,
      setRuntimeStructureRollbackRequest,
      boardFileId,
      overviewScreens,
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleUndoStackRef,
      runtimeStructureDeleteRequest,
      t,
    ],
  );
  const runtimeStructureRollbackResultHandlerRef = useRef(
    handleRuntimeStructureRollbackResult,
  );
  runtimeStructureRollbackResultHandlerRef.current =
    handleRuntimeStructureRollbackResult;
  useEffect(() => {
    if (!runtimeStructureRollbackRequest?.transactionId) return;
    const cancel = scheduleCrossScreenRollbackTimeout(
      runtimeStructureRollbackRequest,
      (request) =>
        runtimeStructureRollbackResultHandlerRef.current({
          requestId: request.requestId,
          transactionId: request.transactionId,
          applied: false,
          reason: "rollback-timeout",
        }),
    );
    runtimeStructureRollbackTimeoutCancelRef.current = cancel;
    return () => {
      cancel();
      if (runtimeStructureRollbackTimeoutCancelRef.current === cancel) {
        runtimeStructureRollbackTimeoutCancelRef.current = null;
      }
    };
  }, [runtimeStructureRollbackRequest]);
  const handleRuntimeLayerRenameApplied = useCallback(
    (
      screenId: string,
      details: {
        requestId: number;
        selector: string;
        sourceId?: string;
        name: string;
        previousName?: string;
        routePath?: string;
      },
    ) => {
      const request = runtimeLayerRenameRequest;
      if (
        !request ||
        request.screenId !== screenId ||
        request.requestId !== details.requestId
      ) {
        return;
      }
      recordPendingLiveLayerNameEdit(
        request.layerId,
        details.name,
        details.previousName,
        details.routePath,
      );
      setRuntimeLayerRenameRequest(null);
    },
    [recordPendingLiveLayerNameEdit, runtimeLayerRenameRequest],
  );
  const runtimeLayerRenameForScreen = useCallback(
    (screenId: string): RuntimeLayerRenameRequest | null => {
      if (runtimeLayerRenameRequest?.screenId === screenId) {
        return runtimeLayerRenameRequest;
      }
      const replay = pendingLayerNameReplayRequest?.patches.find(
        (patch) =>
          patch.screenId === screenId &&
          (!patch.routePath ||
            patch.routePath === liveRoutePathsByScreenIdRef.current[screenId]),
      );
      return replay
        ? {
            requestId: pendingLayerNameReplayRequest!.requestId,
            selector: replay.selector,
            sourceId: replay.sourceId,
            routePath: replay.routePath,
            name: replay.name,
          }
        : null;
    },
    [pendingLayerNameReplayRequest, runtimeLayerRenameRequest],
  );

  const performDeleteFiles = useCallback(
    (
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
    ) =>
      runDeleteFiles(
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
          onFileHistoryMutationSettled: flushPendingFileCreationHistoryEntries,
          clearPendingHistory: clearPendingHistoryDirections,
          files,
          geometryRedoStackRef,
          geometryUndoStackRef,
          historyOrderRef: historyOrderRef as React.RefObject<
            UndoRedoOrderKind[]
          >,
          id,
          latestClipboardMutationContentRef,
          localContentRedoStackRef,
          localContentUndoStackRef,
          queryClient,
          redoOrderRef: redoOrderRef as React.RefObject<UndoRedoOrderKind[]>,
          selectionRevisionRef,
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
        },
        filesToDelete,
        options,
      ),
    [
      activeFile,
      canvasFrameGeometryById,
      clearRedoStacks,
      clearPendingHistoryDirections,
      deleteFileMutation,
      flushPendingFileCreationHistoryEntries,
      overviewSelectedScreenIds,
      queryClient,
      selectedElement,
      selectedLayerIdsState,
      syncUndoRedoState,
      t,
      writeFrameGeometrySnapshot,
    ],
  );
  const handleDeleteInlineFile = useCallback(
    async (fileId: string) => {
      if (!canEditDesign) return;
      if (fileHistoryMutationPendingRef.current) {
        throw new Error(t("common.genericError"));
      }
      const queryKey = ["action", "get-design", { id }] as const;
      let file =
        files.find((candidate) => candidate.id === fileId) ??
        rawServerFilesByIdRef.current.get(fileId) ??
        historyFilesRef.current.find((candidate) => candidate.id === fileId);
      if (!file) {
        await queryClient.refetchQueries({ queryKey, exact: true });
        const refreshed = queryClient.getQueryData<{
          files?: DesignFile[];
        }>(queryKey);
        file = refreshed?.files?.find((candidate) => candidate.id === fileId);
      }
      if (!file) throw new Error(t("common.genericError"));

      const targetFile = file;
      let deleted = false;
      await performDeleteFiles([targetFile], {
        recordDeletionHistory: true,
        onMutationSettled: (deletedFiles) => {
          deleted = deletedFiles.some((candidate) => candidate.id === fileId);
        },
      });
      if (!deleted) throw new Error(t("common.genericError"));
    },
    [canEditDesign, files, id, performDeleteFiles, queryClient, t],
  );

  const handleOverviewNudgeSelection = useCallback(() => {
    if (
      overviewSelectionTargetsElement({
        selectedElement,
        selectedLayerIds: selectedLayerIdsState,
        fileIds: files.map((file) => file.id),
      })
    ) {
      return false;
    }
    return true;
  }, [files, selectedElement, selectedLayerIdsState]);

  const handleDeleteOverviewSelection = useCallback(
    (selectedIds: string[], explicitScreenDeletion = false) => {
      if (!canEditDesign) return false;
      if (fileHistoryMutationPendingRef.current) return false;
      const overviewScreenIds = new Set(
        overviewScreens.map((screen) => screen.id),
      );
      const selectedIdSet = new Set(selectedIds);
      const selectedFiles = files.filter(
        (file) => selectedIdSet.has(file.id) && overviewScreenIds.has(file.id),
      );
      const explicitlySelectedFiles = selectedFiles.filter((file) =>
        explicitOverviewScreenSelectionRef.current.includes(file.id),
      );
      if (
        !explicitScreenDeletion &&
        explicitlySelectedFiles.length === 0 &&
        overviewSelectionTargetsElement({
          selectedElement,
          selectedLayerIds: selectedLayerIdsState,
          fileIds: files.map((file) => file.id),
        })
      ) {
        handleDeleteSelection();
        return false;
      }
      const filesToDelete =
        explicitlySelectedFiles.length > 0
          ? explicitlySelectedFiles
          : selectedFiles;
      if (!filesToDelete.length) return false;

      const explicitScreenIds = explicitScreenDeletion
        ? filesToDelete.map((file) => file.id)
        : explicitlySelectedFiles.map((file) => file.id);
      const selectionRevisionAtStart = selectionRevisionRef.current;
      explicitOverviewScreenSelectionRef.current = [];
      performDeleteFiles(filesToDelete, {
        recordDeletionHistory: true,
        onMutationSettled: (deletedFiles) => {
          if (selectionRevisionRef.current !== selectionRevisionAtStart) return;
          const deletedIds = new Set(deletedFiles.map((file) => file.id));
          explicitOverviewScreenSelectionRef.current = explicitScreenIds.filter(
            (fileId) => !deletedIds.has(fileId),
          );
        },
      });
      return false;
    },
    [
      canEditDesign,
      files,
      performDeleteFiles,
      handleDeleteSelection,
      overviewScreens,
      selectedElement,
      selectedLayerIdsState,
    ],
  );

  const handleCopyProps = useCallback(() => {
    if (!selectedElement) return;
    copiedStylePropsRef.current = {
      color: selectedElement.computedStyles.color,
      backgroundColor: selectedElement.computedStyles.backgroundColor,
      borderColor: selectedElement.computedStyles.borderColor,
      borderStyle: selectedElement.computedStyles.borderStyle,
      borderWidth: selectedElement.computedStyles.borderWidth,
      borderRadius: selectedElement.computedStyles.borderRadius,
      boxShadow: selectedElement.computedStyles.boxShadow,
      opacity: selectedElement.computedStyles.opacity,
      fontFamily: selectedElement.computedStyles.fontFamily,
      fontSize: selectedElement.computedStyles.fontSize,
      fontWeight: selectedElement.computedStyles.fontWeight,
      lineHeight: selectedElement.computedStyles.lineHeight,
      letterSpacing: selectedElement.computedStyles.letterSpacing,
      textAlign: selectedElement.computedStyles.textAlign,
    };
    setHasPropsClipboard(true);
  }, [selectedElement]);

  const handlePasteProps = useCallback(() => {
    if (!canEditActiveVisualScreen) return;
    if (!selectedElement?.selector || !copiedStylePropsRef.current) return;
    const styles = Object.fromEntries(
      Object.entries(copiedStylePropsRef.current).filter(([, value]) =>
        Boolean(value),
      ),
    );
    handleStylesChange(styles);
  }, [canEditActiveVisualScreen, handleStylesChange, selectedElement]);

  const handleCopyAnimation = useCallback(() => {
    if (!selectedMotionTargetNodeId) return;
    const clip = copyLayerAnimation(motionTracks, selectedMotionTargetNodeId);
    if (!clip) return;
    copiedLayerAnimationRef.current = clip;
    setHasAnimationClipboard(true);
  }, [motionTracks, selectedMotionTargetNodeId]);

  const handlePasteAnimation = useCallback(() => {
    if (!canEditDesign) return;
    const clip = copiedLayerAnimationRef.current;
    if (!clip || !selectedMotionTargetNodeId) return;
    const targetNodeId = selectedMotionTargetNodeId;
    setMotionTracks(
      (current) =>
        pasteLayerAnimation(current, clip, targetNodeId) as MotionDockTrack[],
    );
    markMotionTracksDirty();
  }, [canEditDesign, markMotionTracksDirty, selectedMotionTargetNodeId]);

  const parseSelectionScaleValue = useCallback(
    (value: string | undefined): [number, number] => {
      const trimmed = (value ?? "").trim();
      if (!trimmed || trimmed === "none") return [1, 1];
      const parts = trimmed
        .split(/\s+/)
        .filter((token) => token !== "")
        .map(Number);
      const sx = Number.isFinite(parts[0]) ? parts[0]! : 1;
      const sy = Number.isFinite(parts[1]) ? parts[1]! : sx;
      return [sx, sy];
    },
    [],
  );

  const handleFlipHorizontal = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const [sx, sy] = parseSelectionScaleValue(
      selectedElement.computedStyles.scale,
    );
    handleStyleChange("scale", `${sx === -1 ? 1 : -1} ${sy}`);
  }, [
    canEditDesign,
    handleStyleChange,
    parseSelectionScaleValue,
    selectedElement,
  ]);

  const handleFlipVertical = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const [sx, sy] = parseSelectionScaleValue(
      selectedElement.computedStyles.scale,
    );
    handleStyleChange("scale", `${sx} ${sy === -1 ? 1 : -1}`);
  }, [
    canEditDesign,
    handleStyleChange,
    parseSelectionScaleValue,
    selectedElement,
  ]);

  const changeSelectedZIndex = useCallback(
    (mode: "forward" | "front" | "backward" | "back") => {
      if (!canEditDesign && selectedLayerIdsState.length === 1) {
        const selectedId = selectedLayerIdsState[0]!;
        const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
        if (owner && canEditLiveScreen(owner.fileId)) {
          const siblingOrder = findCodeLayerSiblingOrder(
            owner.tree,
            owner.node.id,
          );
          if (!siblingOrder || siblingOrder.siblingIds.length < 2) return;
          const { index, siblingIds } = siblingOrder;
          const anchorId =
            mode === "forward"
              ? siblingIds[index + 1]
              : mode === "backward"
                ? siblingIds[index - 1]
                : mode === "front"
                  ? siblingIds[siblingIds.length - 1]
                  : siblingIds[0];
          if (!anchorId || anchorId === owner.node.id) return;
          const anchorOwner = codeLayerOwnerByNodeIdRef.current.get(anchorId);
          if (!anchorOwner) return;
          runtimeStructureMoveRevisionRef.current += 1;
          setRuntimeStructureMoveRequest({
            requestId: runtimeStructureMoveRevisionRef.current,
            screenId: owner.fileId,
            subject: {
              selector: preferredCodeLayerSelector(owner.node),
              sourceId: bridgeSourceIdForCodeLayerNode(owner.node),
            },
            anchor: {
              selector: preferredCodeLayerSelector(anchorOwner.node),
              sourceId: bridgeSourceIdForCodeLayerNode(anchorOwner.node),
            },
            placement:
              mode === "forward" || mode === "front" ? "after" : "before",
          });
          return;
        }
      }
      return runChangeSelectedZIndex(
        {
          activeFile,
          applyLinkedComponentEdit,
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          applyLocalContentUpdate,
          canEditDesign,
          codeLayerOwnerByNodeIdRef,
          commitVisualStyles,
          getFreshActiveContent,
          invalidateRenderedElementInfo,
          renderedElementInfoByLayerKeyRef,
          reportRefusal: (reason) =>
            toast.error(
              t(
                reason === "linked-component"
                  ? "designEditor.componentInstances.linkedEditScopeUnsupported"
                  : "designEditor.patchProof.selectorMissing",
              ),
              { duration: 4000 },
            ),
          responsiveEditScopeRef,
          selectedElement,
          selectedLayerIdsState,
          setSelectedElement,
        },
        mode,
      );
    },
    [
      activeFile,
      activeBreakpointUpperBoundPx,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      commitVisualStyles,
      getFreshActiveContent,
      invalidateRenderedElementInfo,
      t,
      selectedElement,
      selectedLayerIdsState,
      setRuntimeStructureMoveRequest,
    ],
  );

  const selectionChromeHiddenRef = useRef(false);
  const selectionChromeSettleTimerRef = useRef<number | undefined>(undefined);
  const restoreSelectionChrome = useCallback(() => {
    if (selectionChromeSettleTimerRef.current !== undefined) {
      window.clearTimeout(selectionChromeSettleTimerRef.current);
      selectionChromeSettleTimerRef.current = undefined;
    }
    if (!selectionChromeHiddenRef.current) return;
    selectionChromeHiddenRef.current = false;
    canvasIframeRef.current?.contentWindow?.postMessage(
      { type: "set-selection-chrome-hidden", hidden: false },
      "*",
    );
  }, [canvasIframeRef]);
  const hideSelectionChromeForNudge = useCallback(() => {
    if (!selectionChromeHiddenRef.current) {
      selectionChromeHiddenRef.current = true;
      canvasIframeRef.current?.contentWindow?.postMessage(
        { type: "set-selection-chrome-hidden", hidden: true },
        "*",
      );
    }
    if (selectionChromeSettleTimerRef.current !== undefined) {
      window.clearTimeout(selectionChromeSettleTimerRef.current);
    }
    selectionChromeSettleTimerRef.current = window.setTimeout(() => {
      selectionChromeSettleTimerRef.current = undefined;
      restoreSelectionChrome();
    }, 800);
  }, [canvasIframeRef, restoreSelectionChrome]);
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        restoreSelectionChrome();
      }
    };
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      if (selectionChromeSettleTimerRef.current !== undefined) {
        window.clearTimeout(selectionChromeSettleTimerRef.current);
      }
    };
  }, [restoreSelectionChrome]);

  const handleNudgeSelection = useCallback(
    (direction: "up" | "right" | "down" | "left", largeStep: boolean) =>
      runNudgeSelection(
        {
          activeFile,
          applyLinkedComponentEdit,
          applyLocalContentUpdate,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          isRunningAppSource: isRunningAppSourceType(activeCanvasSourceType),
          commitVisualStyles,
          designDataJsonRef,
          editorPreferences,
          files,
          getFreshActiveContent,
          handleGeometryCommit,
          hideSelectionChromeForNudge,
          overviewScreens,
          overviewSelectedScreenIds,
          selectedElement,
          selectedLayerIdsState,
          selectedLayerTargetsRef,
          renderedElementInfoByLayerKeyRef,
          setSelectedElement,
          setSelectedLayerIdsState,
          viewModeRef,
        },
        direction,
        largeStep,
      ),
    [
      activeCanvasSourceType,
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      canEditActiveVisualScreen,
      commitVisualStyles,
      editorPreferences.nudge,
      files,
      getFreshActiveContent,
      handleGeometryCommit,
      hideSelectionChromeForNudge,
      liveScreenSnapshotsById,
      overviewScreens,
      overviewSelectedScreenIds,
      recordPendingLiveStructureEdit,
      runtimeLayerSnapshotsById,
      selectedElement,
      selectedLayerIdsState,
    ],
  );

  const applyDesignDataHistoryChanges = useCallback(
    (changes: readonly ContentHistoryChange[], direction: "undo" | "redo") => {
      const operations = changes.flatMap(
        (change) => change.designDataChange?.[direction] ?? [],
      );
      if (operations.length === 0) return true;
      if (!id) return false;
      const nextData = applyDesignDataOperations(
        designDataJsonRef.current,
        operations,
      );
      designDataJsonRef.current = nextData;
      const screenMetadata = getDesignDataRecord(nextData, "screenMetadata");
      for (const screenId of new Set(
        operations
          .filter(
            (operation) =>
              operation.path[0] === "screenMetadata" &&
              operation.path.length > 1,
          )
          .map((operation) => operation.path[1]),
      )) {
        const metadata = getDesignDataRecord(screenMetadata, screenId);
        if (
          resolveScreenHeightMode(
            metadata.heightMode,
            metadata.heightPinned === true,
            metadata.sourceType,
          ) === "fixed"
        ) {
          locallyPinnedHeightIdsRef.current.add(screenId);
        } else {
          locallyPinnedHeightIdsRef.current.delete(screenId);
        }
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) =>
        old && typeof old === "object"
          ? { ...old, data: JSON.stringify(nextData) }
          : old,
      );
      return enqueueFrameGeometryDataSave(operations);
    },
    [enqueueFrameGeometryDataSave, id, queryClient],
  );
  applyGeometryHistoryContentChangesRef.current = (changes, direction) => {
    for (const change of changes) {
      const content = direction === "undo" ? change.before : change.after;
      if (change.before === change.after) continue;
      applyFileContentUpdate(change.fileId, content, {
        recordHistory: false,
      });
    }
    if (direction !== "commit") {
      applyDesignDataHistoryChanges(changes, direction);
    }
  };

  const runCurrentUndo = useCallback(
    () =>
      runUndo({
        activeEditorDragRef,
        activeFile,
        applyFileContentUpdate,
        applyDesignDataHistoryChanges,
        applyGeometryHistoryContentChanges: (changes, direction) =>
          applyGeometryHistoryContentChangesRef.current(changes, direction),
        applyLocalContentUpdate,
        canEditDesign,
        allowPendingLiveEdits: canEditLiveScreens && !canEditDesign,
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
        designDataJsonRef,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef,
        fileDeletionRedoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        clearPendingHistory: clearPendingHistoryDirections,
        onFileHistoryMutationSettled: flushPendingFileCreationHistoryEntries,
        files,
        filesRef: historyFilesRef,
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
        selectionRedoStackRef,
        selectionUndoStackRef,
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
      }),
    [
      ydoc,
      activeFile,
      applyFileContentUpdate,
      applyDesignDataHistoryChanges,
      applyGeometryHistoryContentChangesRef,
      applyLocalContentUpdate,
      canEditDesign,
      canEditLiveScreens,
      clearPendingHistoryDirections,
      createFileMutation,
      deleteFileMutation,
      files,
      getFreshActiveContent,
      getScreenContent,
      id,
      isSynced,
      liveScreenSnapshotsById,
      markPendingLocalFileContent,
      flushPendingFileCreationHistoryEntries,
      optimisticallyInsertCreatedFile,
      performDeleteFiles,
      publishAuthoritativeClipboardMutation,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
      resetGeometryCommitCoalescing,
      restoreSelectionSnapshot,
      requestPendingLiveNonStyleRevert,
      requestPendingVisualStyleRevert,
      syncLiveScreenSnapshotPreview,
      syncUndoRedoState,
      updateLiveScreenSnapshotContent,
      writeFrameGeometrySnapshot,
      t,
    ],
  );

  const runCurrentRedo = useCallback(
    () =>
      runRedo({
        activeEditorDragRef,
        activeFile,
        applyFileContentUpdate,
        applyDesignDataHistoryChanges,
        applyGeometryHistoryContentChanges: (changes, direction) =>
          applyGeometryHistoryContentChangesRef.current(changes, direction),
        applyLocalContentUpdate,
        canEditDesign,
        allowPendingLiveEdits: canEditLiveScreens && !canEditDesign,
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
        clearPendingHistory: clearPendingHistoryDirections,
        files,
        filesRef: historyFilesRef,
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
        onFileHistoryMutationSettled: flushPendingFileCreationHistoryEntries,
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
        setPendingVisualStyleEdits,
        setPendingVisualStyleBaselineResetRequest,
        setPendingVisualStyleRevertRequest,
        setRuntimeStructureDeleteRequest,
        setRuntimeStructureInsertRequest,
        setRuntimeStructureMoveRequest,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        suppressContentHistoryRef,
        syncLiveScreenSnapshotPreview,
        syncUndoRedoState,
        t,
        undoManagerRef,
        updateDesignAsync,
        updateLiveScreenSnapshotContent,
        viewModeRef,
        writeFrameGeometrySnapshot,
        ydoc,
      }),
    [
      ydoc,
      activeFile,
      applyFileContentUpdate,
      applyDesignDataHistoryChanges,
      applyGeometryHistoryContentChangesRef,
      applyLocalContentUpdate,
      canEditDesign,
      canEditLiveScreens,
      clearPendingHistoryDirections,
      createFileMutation,
      deleteFileMutation,
      deleteRuntimeElement,
      files,
      focusCreatedScreen,
      getFreshActiveContent,
      getScreenContent,
      id,
      isSynced,
      liveScreenSnapshotsById,
      markPendingLocalFileContent,
      flushPendingFileCreationHistoryEntries,
      optimisticallyInsertCreatedFile,
      overviewScreens.length,
      performDeleteFiles,
      publishAuthoritativeClipboardMutation,
      queryClient,
      queueFileContentSave,
      recordLocalContentHistoryChangeFallback,
      replacePreviewContent,
      resetGeometryCommitCoalescing,
      replayPendingVisualStyleRuntime,
      restoreSelectionSnapshot,
      setPendingVisualStyleBaselineResetRequest,
      syncLiveScreenSnapshotPreview,
      syncUndoRedoState,
      t,
      updateDesignAsync,
      updateLiveScreenSnapshotContent,
      writeFrameGeometrySnapshot,
    ],
  );

  return {
    runtimeStructureMoveRequest,
    setRuntimeStructureMoveRequest,
    runtimeStructureMoveRevisionRef,
    setRuntimeLayerRenameRequest,
    hasPropsClipboard,
    hasAnimationClipboard,
    handleRuntimeStructureRollbackResult,
    handleRuntimeLayerRenameApplied,
    runtimeLayerRenameForScreen,
    handleDeleteInlineFile,
    handleOverviewNudgeSelection,
    handleDeleteOverviewSelection,
    handleCopyProps,
    handlePasteProps,
    handleCopyAnimation,
    handlePasteAnimation,
    handleFlipHorizontal,
    handleFlipVertical,
    changeSelectedZIndex,
    handleNudgeSelection,
    runCurrentUndo,
    runCurrentRedo,
  };
}

export type EditorEditCommands = ReturnType<typeof useEditorEditCommands>;

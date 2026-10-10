import {
  useActionQuery,
  useActionMutation,
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { pinCodeLayerDocuments } from "@shared/code-layer";
import { extractProps } from "@shared/component-model";
import { normalizeScreenHtml } from "@shared/screen-annotation";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  useId,
} from "react";
import { flushSync } from "react-dom";
import { useBlocker } from "react-router";
import { toast } from "sonner";

import type { DesignImportPanelHandle } from "@/components/design/DesignImportPanel";
import { isTextElement } from "@/components/design/EditPanel";
import {
  beginEyedropperPick,
  hasEyeDropperSupport,
} from "@/components/design/inspector";
import { isEditorHotkeyBlockedByShortcutsDialog } from "@/components/design/KeyboardShortcutsDialog";
import { type LocalhostWriteConsentPayload } from "@/components/design/LocalhostWriteConsentDialog";
import { useDesignHotkeys } from "@/hooks/useDesignHotkeys";

import {
  collectCodeLayerAncestors,
  elementInfoForOwnedCodeLayerNode,
  elementInfoFromCodeLayerNode,
} from "../code-layer-state";
import { runBooleanSubtractSelection } from "../commands/boolean-subtract-selection";
import {
  readLocalVisualEditPendingState,
  runPublishVisualEditPending,
  shouldPublishVisualEditPending,
} from "../commands/publish-visual-edit-pending";
import { runSwapFillStroke } from "../commands/swap-fill-stroke";
import {
  AUTO_RETRY_DELAY_MS,
  MAX_GENERATION_ATTEMPTS,
  NO_LOCALHOST_CONNECTION_MESSAGE,
} from "../editor-constants";
import { getDesignEditorStateUrlSearch } from "../editor-state";
import { runInIdleSlices } from "../idle-slices";
import {
  reconcileLayerStateIds,
  sourceLayerStateIds,
} from "../layer-state-scope";
import {
  clearPendingEditSessionMarker,
  writePendingEditSessionMarker,
} from "../pending-edit-session-marker";
import {
  isVisualEditHandoffAcknowledged,
  projectRelativeSourcePath,
  shouldBlockPendingVisualStyleNavigation,
  shouldPublishVisualEditHandoff,
  updateReloadedVisualEditHandoff,
  updateVisualEditHandoffPublication,
} from "../pending-edits";
import { usePendingLiveEditUnloadGuard } from "../pending-live-edit-unload-guard";
import { blurActiveDesignEditableTarget } from "../png-export-render";
import { findDesignFileByScreenTarget } from "../screen-command-utils";
import { annotationHotkeyHandlers } from "../tool-state";
import { SHOW_DESIGN_SECONDARY_LEFT_PANELS } from "../types";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorClipboard } from "./use-editor-clipboard";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorEditCommands } from "./use-editor-edit-commands";
import type { EditorExportAndHandoff } from "./use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLayerActions } from "./use-editor-layer-actions";
import type { EditorLayerModels } from "./use-editor-layer-models";
import type { EditorLayoutAndStructure } from "./use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorModes } from "./use-editor-modes";
import type { EditorScreenInspector } from "./use-editor-screen-inspector";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorSourceAndSync({
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
  editorClipboard,
  editorLayoutAndStructure,
  editorEditCommands,
  editorModes,
  editorExportAndHandoff,
  editorLayerModels,
  editorScreenInspector,
  editorLayerActions,
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
  editorClipboard: EditorClipboard;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorEditCommands: EditorEditCommands;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerModels: EditorLayerModels;
  editorScreenInspector: EditorScreenInspector;
  editorLayerActions: EditorLayerActions;
}) {
  const {
    t,
    id,
    location,
    initialRouteScreenGuardRef,
    queryClient,
    hostOwnsChrome,
    mode,
    setMode,
    activeTool,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    selectedElementRef,
    setPendingVisualEditPublicationFailed,
    setPendingVisualEditRecoveryVisible,
    setPendingEditSessionMarker,
    pendingEditSessionDesignIdRef,
    pendingVisualEditPublicationRevisionRef,
    pendingVisualEditBridgeRevisionSyncKeyRef,
    pendingVisualEditPublisherIdRef,
    pendingVisualEditClearRequestedRef,
    pendingVisualEditHadPendingRef,
    pendingVisualEditHandoffPublicationRef,
    pendingVisualEditHandoffServerRevision,
    setPendingVisualEditHandoffServerRevision,
    pendingVisualEditReloadedHandoffRef,
    requestPendingVisualStyleRevert,
    requestPendingLiveNonStyleRevert,
    textEditingState,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    pendingVisualStyleEdits,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEditsRef,
    pendingLiveNonStyleEditsRef,
    clearPendingLiveEditState,
    minimalUi,
    clearPendingLiveEditStateRef,
    clearReloadedPendingLiveEdits,
    activeLeftPanel,
    setExpandedLayerIds,
    revealLayerIds,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    schedulePendingOverviewLayerSelectionClear,
    setLockedLayerIds,
    setHiddenLayerIds,
    layerStateOverridesRef,
    motionDockOpen,
    focusDesignInspectorForSelection,
    undoManagerRef,
    contentUndoStackRef,
    selectedLayerIdsStateRef,
    explicitOverviewScreenSelectionRef,
    hasPendingVisualStyleEdits,
    pendingVisualEditCount,
    hasLocalPendingVisualEdits,
  } = editorHistory;
  const {
    setDrawMode,
    setPinMode,
    generationIssue,
    retryablePrompt,
    autoRetryTimerRef,
    clearAutoRetryTimer,
    generating,
    pendingQuestions,
    pendingGenerationActive,
    design,
    canEditDesign,
    canEditLiveScreens,
    canCommentDesign,
    historyFilesRef,
    startRetryGeneration,
  } = editorGenerationAndAccess;
  const {
    navigate,
    setTitleEditing,
    setTitleDraft,
    selectedPromptDesignSystemId,
    files,
    handleToggleLayoutGrids,
    overviewScreens,
    remoteVisualEditPending,
  } = editorFilesAndSaving;
  const {
    setLocalhostWriteConsentOpen,
    setLocalhostWriteConsentPayload,
    setLocalhostConsentConnectionId,
    activeFile,
    activeOverviewScreen,
    activeScreenBridgeUrl,
    activeScreenPreviewToken,
    activeScreenLiveEditCapability,
    setZoom,
    activeCanvasSourceType,
    handleZoomIn,
    handleZoomOut,
    handleCycleFile,
  } = editorActiveScreenAndGeometry;
  const {
    localhostConnectionRootPathByIdRef,
    setHoveredElementScreenId,
    activeContent,
    getProjectionContentForScreen,
    handleZoomToFit,
  } = editorCanvasAndScreens;
  const {
    zoom,
    resolvedTheme,
    initialGenerationChromeLimited,
    selectedCodeLayerNode,
    selectedElementLayerId,
    canEditLiveScreen,
    selectedComponentNodeId,
  } = editorLiveEditsAndPresence;
  const {
    requestLocalhostWriteRef,
    contentHistorySelectionAfterRef,
    selectedInstanceActionNodeId,
    selectedComponentLiteralProps,
    selectedComponentLocalSource,
    handleCreateComponentHotkey,
    applyLocalContentUpdate,
    handleDetachInstanceMenuAction,
    handleToggleMinimalUi,
    handleShowAssetsPanel,
    uiHidden,
  } = editorContentAndComponents;
  const {
    activeCodeFile,
    selectedScreenIds,
    handleMoveTool,
    handleRectTool,
    handleLineTool,
    handleArrowTool,
    handleEllipseTool,
  } = editorToolsAndVectors;
  const {
    selectedLayerTargetsRef,
    canEditActiveVisualScreen,
    shouldPreserveBlockedOverviewLayerSelectionRef,
    getFreshActiveContent,
    handleStyleChange,
    handleToggleUnderlineHotkey,
    handleToggleStrikethroughHotkey,
    handleStylesChange,
    handleFrameSelection,
  } = editorSelectionAndStyles;
  const {
    handleCopySelection,
    handlePasteSelection,
    handlePasteOverSelection,
    handlePasteToReplace,
    handleDuplicateSelection,
    handleDeleteSelection,
    handleGroupSelection,
    handleUngroupSelection,
    handleCutSelection,
    handleZoomToSelectionFit,
  } = editorClipboard;
  const {
    handleAlignSelection,
    handleDistributeSelection,
    handleTidyUp,
    handleAddAutoLayout,
    handleToggleUi,
    handleToggleComments,
  } = editorLayoutAndStructure;
  const {
    handleDeleteOverviewSelection,
    handleCopyProps,
    handlePasteProps,
    handleFlipHorizontal,
    handleFlipVertical,
    changeSelectedZIndex,
    handleNudgeSelection,
  } = editorEditCommands;
  const {
    handleUndo,
    handleRedo,
    responsiveInteractActive,
    handlePinToolToggle,
    handleToggleKeyboardShortcuts,
    handleEscapeHotkey,
    handleEnterHotkey,
    handleCycleSibling,
    handleSelectParentLayer,
  } = editorModes;
  const {
    pendingVisualEditPublicationQueueRef,
    layersPanelRef,
    handleSelectAllFrames,
    handleShowLayersPanel,
    handleFindLayers,
    pendingVisualStylePrompt,
    handleCopyAsPng,
  } = editorExportAndHandoff;
  const {
    initialRouteSelectionId,
    layersSearchQuery,
    activeCodeLayerTree,
    recentLayerModelFileIdsRef,
    setCoveredLayerModelFileIds,
    layerModelsCoverAll,
    codeLayerModelsByFile,
    getCodeLayerProjectionForScreenRef,
    getProjectionContentForScreenRef,
    coveredLayerModelFileIdsRef,
    layersSearchQueryRef,
    codeLayerOwnerByNodeId,
    resolvedInitialRouteSelectionId,
    effectiveCodeLayerState,
    designIsEmpty,
    selectedLayerIds,
    getSingleSelectedRenamableLayerId,
    canEditSelectedLiveLayer,
    canEditSingleSelectedLiveLayer,
    selectedUrlSelectionId,
    selectedLayerIdsRef,
    selectedLayerTargets,
  } = editorLayerModels;
  const {
    commitOverviewScreenStylesRef,
    handleSelectedScreenStyleChange,
    canvasBackground,
    setThemedCanvasBackground,
    selectionColorPreviewHistoryRef,
    selectionColorPickerSessionRef,
    selectionColorScopeIdentity,
  } = editorScreenInspector;
  const {
    activeScreenIsLocalSource,
    activeScreenRouteSourceFile,
    handleToggleHiddenForSelection,
    handleToggleLockedForSelection,
  } = editorLayerActions;

  const [frameToolDraws, setFrameToolDraws] = useState<"screen" | "frame">(
    "frame",
  );
  const initialUrlSelectionHydratedForIdRef = useRef<string | null>(null);
  const canEditSelectedLiveLayerRef = useRef(false);
  const urlSyncTimerRef = useRef<number | null>(null);
  const urlSyncScreenIdRef = useRef<string | null>(null);

  const handleFrameTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("frame");
      if (viewModeRef.current === "single" && activeFile) {
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
        return;
      }
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
      viewModeRef.current = "overview";
      setViewMode("overview");
    });
  }, [activeFile, canEditDesign]);

  const handleTextTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("text");
      if (viewModeRef.current === "single" && activeFile) {
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
        return;
      }
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    });
  }, [activeFile, canEditDesign]);

  const handlePenTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("pen");
      if (viewModeRef.current === "single" && activeFile) {
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
        return;
      }
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    });
  }, [activeFile, canEditDesign]);

  const handleHandTool = useCallback(() => {
    blurActiveDesignEditableTarget();
    setActiveTool("hand");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    if (viewModeRef.current === "single" && activeFile) {
      return;
    }
    viewModeRef.current = "overview";
    setViewMode("overview");
  }, [activeFile]);

  const handleScaleTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    blurActiveDesignEditableTarget();
    setActiveTool("scale");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, [activeFile, canEditDesign]);

  const handleDrawTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    setActiveTool("draw");
    setMode("annotate");
    setSelectedElement(null);
    setDrawMode(true);
    setPinMode(false);
  }, [activeFile, canEditDesign]);

  const handleBooleanSubtractSelection = useCallback(
    () =>
      runBooleanSubtractSelection({
        activeFile,
        applyLocalContentUpdate,
        canEditDesign,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        files,
        getFreshActiveContent,
        overviewSelectedScreenIds,
        selectedLayerIdsState,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleSwapFillStroke = useCallback(
    () =>
      runSwapFillStroke({
        canEditDesign,
        selectedElement,
        handleStylesChange,
      }),
    [canEditDesign, handleStylesChange, selectedElement],
  );

  const handleEyedropper = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    if (!hasEyeDropperSupport()) {
      toast.info(t("designEditor.toasts.eyedropperUnsupported"));
      return;
    }
    void (async () => {
      const hex = await beginEyedropperPick();
      if (!hex) return;
      const property = isTextElement(selectedElement)
        ? "color"
        : "backgroundColor";
      handleStyleChange(property, hex);
    })();
  }, [canEditDesign, handleStyleChange, selectedElement, t]);

  const shouldHandleEditorHotkey = useCallback((event: KeyboardEvent) => {
    // The shortcuts dialog is modal: only its own open/close chord leaves it.
    if (isEditorHotkeyBlockedByShortcutsDialog(event)) return false;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const primary = event.metaKey || event.ctrlKey;
    const plainPasteHotkey =
      primary && key === "v" && !event.altKey && !event.shiftKey;
    if (!plainPasteHotkey) return true;
    return (
      (event as KeyboardEvent & { __agentNativeIframeHotkey?: boolean })
        .__agentNativeIframeHotkey === true
    );
  }, []);

  const opacitySelectionKey =
    canEditDesign && !textEditingState.active
      ? selectedElement
        ? `${activeFileId ?? activeFile?.id ?? ""}:${selectedLayerIdsState.length > 1 ? [...selectedLayerIdsState].sort().join(",") : ""}:${selectedElement.selector ?? selectedElement.sourceId ?? ""}`
        : viewMode === "overview" && overviewSelectedScreenIds.length > 0
          ? overviewSelectedScreenIds.length === 1
            ? `screen:${overviewSelectedScreenIds[0]}`
            : `screens:${[...overviewSelectedScreenIds].sort().join(",")}`
          : null
      : null;
  // Only a search needs every screen's layers; building them up front holds
  // hundreds of megabytes on a large board that a session mostly never opens.
  const layersSearching = layersSearchQuery.trim() !== "";
  // The worklist restarts when a screen is added, removed, or replaced; edits
  // keep their ids, so typing never restarts it.
  const fileIdsKey = useMemo(
    () => files.map((file) => file.id).join("\u0000"),
    [files],
  );
  const projectionPinOwner = useId();
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(
    null,
  );
  const activeLocalhostConnectionId = activeScreenIsLocalSource
    ? ((activeOverviewScreen as { connectionId?: string } | undefined)
        ?.connectionId ?? "")
    : "";

  useDesignHotkeys({
    enabled:
      !hostOwnsChrome &&
      !responsiveInteractActive &&
      !(pendingQuestions && pendingQuestions.length > 0),
    shouldHandleEvent: shouldHandleEditorHotkey,
    canClaimBoundChords: canEditDesign || canEditLiveScreens,
    onMoveTool: canEditDesign ? handleMoveTool : undefined,
    onFrameTool: canEditDesign
      ? () => {
          setFrameToolDraws("frame");
          handleFrameTool();
        }
      : undefined,
    onRectangleTool: canEditDesign ? handleRectTool : undefined,
    onLineTool: canEditDesign ? handleLineTool : undefined,
    onArrowTool: canEditDesign ? handleArrowTool : undefined,
    onEllipseTool: canEditDesign ? handleEllipseTool : undefined,
    onTextTool: canEditDesign ? handleTextTool : undefined,
    onPenTool: canEditDesign ? handlePenTool : undefined,
    onHandTool: handleHandTool,
    ...annotationHotkeyHandlers({
      canEditDesign,
      canCommentDesign,
      onComment: handlePinToolToggle,
      onDraw: handleDrawTool,
    }),
    onScaleTool: canEditDesign ? handleScaleTool : undefined,
    onCopy: handleCopySelection,
    onCopyAsPng:
      canEditDesign &&
      (Boolean(selectedElement) ||
        (viewMode === "overview" && selectedScreenIds.length === 1))
        ? () => void handleCopyAsPng()
        : undefined,
    onPaste: canEditDesign ? () => void handlePasteSelection() : undefined,
    onCut: canEditDesign ? handleCutSelection : undefined,
    onPasteOver: canEditDesign ? handlePasteOverSelection : undefined,
    onPasteToReplace: canEditDesign
      ? () => void handlePasteToReplace()
      : undefined,
    onCopyProps: canEditActiveVisualScreen ? handleCopyProps : undefined,
    onPasteProps: canEditActiveVisualScreen ? handlePasteProps : undefined,
    onDuplicate: canEditActiveVisualScreen
      ? handleDuplicateSelection
      : undefined,
    onDelete:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => {
            if (!canEditDesign && canEditSelectedLiveLayer) {
              handleDeleteSelection();
              return;
            }
            handleDeleteOverviewSelection(overviewSelectedScreenIds);
          }
        : undefined,
    onRename: () => {
      if (!canEditDesign && !canEditSingleSelectedLiveLayer) return;
      const layerId = getSingleSelectedRenamableLayerId();
      if (layerId) {
        layersPanelRef.current?.beginRename(layerId);
        return;
      }
      if (!canEditDesign) return;
      setTitleDraft(design?.title ?? "");
      setTitleEditing(true);
    },
    onFind: initialGenerationChromeLimited ? undefined : handleFindLayers,
    onShowLayersPanel: initialGenerationChromeLimited
      ? undefined
      : handleShowLayersPanel,
    onShowAssetsPanel:
      initialGenerationChromeLimited || !SHOW_DESIGN_SECONDARY_LEFT_PANELS
        ? undefined
        : handleShowAssetsPanel,
    onGroup: canEditDesign ? handleGroupSelection : undefined,
    onUngroup: canEditDesign ? handleUngroupSelection : undefined,
    onFrameSelection: canEditDesign ? handleFrameSelection : undefined,
    onBooleanSubtract: canEditDesign
      ? handleBooleanSubtractSelection
      : undefined,
    onToggleHidden:
      canEditDesign || canEditLiveScreens
        ? () => handleToggleHiddenForSelection()
        : undefined,
    onToggleLocked:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => handleToggleLockedForSelection()
        : undefined,
    onSelectAll: handleSelectAllFrames,
    onUndo: canEditDesign || canEditLiveScreens ? handleUndo : undefined,
    onRedo: canEditDesign || canEditLiveScreens ? handleRedo : undefined,
    onBringForward:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("forward")
        : undefined,
    onBringToFront:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("front")
        : undefined,
    onSendBackward:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("backward")
        : undefined,
    onSendToBack:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("back")
        : undefined,
    onEscape: responsiveInteractActive ? undefined : handleEscapeHotkey,
    onEnter: handleEnterHotkey,
    onSelectParent: handleSelectParentLayer,
    onTab: ({ backwards }) => handleCycleSibling(backwards),
    onNextFrame: () => handleCycleFile(false),
    onPreviousFrame: () => handleCycleFile(true),
    onNudge: ({ direction, largeStep }) =>
      handleNudgeSelection(direction, largeStep),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: () => setZoom(100),
    onZoomToFit: handleZoomToFit,
    onZoomToSelection: () => {
      if (viewMode === "overview") {
        handleZoomToSelectionFit();
        return;
      }
      if (selectedElement) setZoom(150);
    },
    onCreateComponent: canEditDesign ? handleCreateComponentHotkey : undefined,
    onDetachInstance:
      canEditDesign && selectedInstanceActionNodeId
        ? handleDetachInstanceMenuAction
        : undefined,
    opacitySelectionKey,
    onOpacityChange: opacitySelectionKey
      ? ({ opacity }) => {
          const value = String(opacity / 100);
          if (selectedElement) {
            handleStyleChange("opacity", value);
          } else if (
            viewMode === "overview" &&
            overviewSelectedScreenIds.length > 1
          ) {
            commitOverviewScreenStylesRef.current(overviewSelectedScreenIds, {
              opacity: value,
            });
          } else {
            handleSelectedScreenStyleChange("opacity", value);
          }
        }
      : undefined,
    onToggleUnderline:
      canEditDesign && selectedElement
        ? handleToggleUnderlineHotkey
        : undefined,
    onToggleStrikethrough:
      canEditDesign && selectedElement
        ? handleToggleStrikethroughHotkey
        : undefined,
    onFlipHorizontal: canEditDesign ? handleFlipHorizontal : undefined,
    onFlipVertical: canEditDesign ? handleFlipVertical : undefined,
    onSwapFillStroke: canEditDesign ? handleSwapFillStroke : undefined,
    onEyedropper: canEditDesign ? handleEyedropper : undefined,
    onAlignSelection: canEditDesign
      ? ({ edge }) => handleAlignSelection(edge)
      : undefined,
    onDistributeSelection: canEditDesign
      ? ({ axis }) => handleDistributeSelection(axis)
      : undefined,
    onTidyUp: canEditDesign ? handleTidyUp : undefined,
    onAddAutoLayout: canEditDesign ? handleAddAutoLayout : undefined,
    onToggleUi: handleToggleUi,
    onToggleMinimalUi: handleToggleMinimalUi,
    onToggleComments: handleToggleComments,
    onToggleLayoutGrids: canEditDesign ? handleToggleLayoutGrids : undefined,
    onShowKeyboardShortcuts: handleToggleKeyboardShortcuts,
  });

  useEffect(() => {
    clearAutoRetryTimer();
    if (
      !retryablePrompt ||
      !generationIssue ||
      !canEditDesign ||
      generating ||
      pendingGenerationActive
    ) {
      return;
    }
    const completedAttempt = retryablePrompt.attempt ?? 1;
    if (completedAttempt >= MAX_GENERATION_ATTEMPTS) return;

    autoRetryTimerRef.current = window.setTimeout(() => {
      autoRetryTimerRef.current = null;
      void startRetryGeneration(retryablePrompt, completedAttempt + 1, "auto");
    }, AUTO_RETRY_DELAY_MS);

    return clearAutoRetryTimer;
  }, [
    canEditDesign,
    retryablePrompt,
    generationIssue,
    generating,
    pendingGenerationActive,
    startRetryGeneration,
    clearAutoRetryTimer,
  ]);
  usePendingLiveEditUnloadGuard(hasPendingVisualStyleEdits);
  const importPanelRef = useRef<DesignImportPanelHandle | null>(null);
  const skipPendingEditNavigationBlockRef = useRef(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  // The import panel lives in the left sidebar, which is unmounted in minimal
  // UI, so hand the file over only once that sidebar is back.
  const importPanelMounted = !hostOwnsChrome && !uiHidden && !minimalUi;
  useEffect(() => {
    if (!pendingImportFile || !importPanelMounted) return;
    importPanelRef.current?.importFile(pendingImportFile);
    setPendingImportFile(null);
  }, [pendingImportFile, importPanelMounted]);
  const pendingVisualStyleNavigationBlocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        !skipPendingEditNavigationBlockRef.current &&
        shouldBlockPendingVisualStyleNavigation({
          hasPendingVisualStyleEdits,
          currentPathname: currentLocation.pathname,
          nextPathname: nextLocation.pathname,
        }),
      [hasPendingVisualStyleEdits],
    ),
  );
  const handleStayOnPendingVisualStyleNavigation = useCallback(() => {
    if (pendingVisualStyleNavigationBlocker.state !== "blocked") return;
    pendingVisualStyleNavigationBlocker.reset();
  }, [pendingVisualStyleNavigationBlocker]);
  const handleDiscardPendingVisualStylesAndNavigate = useCallback(() => {
    if (pendingVisualStyleNavigationBlocker.state !== "blocked") return;
    requestPendingVisualStyleRevert(pendingVisualStyleEdits);
    requestPendingLiveNonStyleRevert(pendingLiveNonStyleEdits);
    clearPendingLiveEditState();
    pendingVisualStyleNavigationBlocker.proceed();
  }, [
    clearPendingLiveEditState,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEdits,
    pendingVisualStyleNavigationBlocker,
    requestPendingLiveNonStyleRevert,
    requestPendingVisualStyleRevert,
  ]);
  const pendingVisualEditHandoffQuery = useActionQuery<{
    status: "empty" | "ready";
    revision: number | null;
    publisherId: string | null;
    clientRevision: number | null;
  }>(
    "get-visual-edit-pending",
    { designId: id! },
    {
      enabled: Boolean(id) && canEditDesign && pendingVisualEditCount > 0,
      refetchInterval:
        canEditDesign && pendingVisualEditCount > 0 ? 10_000 : false,
      refetchIntervalInBackground: false,
    },
  );
  useEffect(() => {
    if (!id) return;
    if (pendingVisualEditCount > 0) {
      pendingEditSessionDesignIdRef.current = id;
      const result = writePendingEditSessionMarker(id, pendingVisualEditCount);
      setPendingEditSessionMarker(
        result.status === "stored"
          ? { status: "absent" }
          : { status: "unavailable", reason: result.reason },
      );
      return;
    }
    if (pendingEditSessionDesignIdRef.current === id) {
      pendingEditSessionDesignIdRef.current = null;
      const result = clearPendingEditSessionMarker(id);
      if (result.status === "unavailable") {
        setPendingEditSessionMarker(result);
      }
    }
  }, [id, pendingVisualEditCount]);
  useEffect(() => {
    if (!hasLocalPendingVisualEdits && !remoteVisualEditPending) {
      setPendingVisualEditRecoveryVisible(false);
    }
  }, [hasLocalPendingVisualEdits, remoteVisualEditPending]);
  useEffect(() => {
    if (
      !id ||
      !shouldPublishVisualEditPending({
        designId: id,
        canEditDesign,
        canEditLiveScreen: canEditLiveScreen(activeOverviewScreen?.id),
      })
    ) {
      return;
    }
    if (
      !shouldPublishVisualEditHandoff({
        designId: id,
        pendingEditCount: pendingVisualEditCount,
        clearRequestedDesignId: pendingVisualEditClearRequestedRef.current,
        hadPendingDesignId: pendingVisualEditHadPendingRef.current,
      })
    ) {
      return;
    }
    const pendingEditCount = pendingVisualEditCount;
    const pendingPrompt = pendingVisualStylePrompt;
    const bridgeRevisionSyncKey =
      activeScreenBridgeUrl &&
      activeScreenPreviewToken &&
      activeScreenLiveEditCapability
        ? `${id}\u0000${activeScreenBridgeUrl}`
        : null;
    if (pendingVisualEditCount > 0) {
      pendingVisualEditClearRequestedRef.current = null;
      pendingVisualEditHadPendingRef.current = id;
    }
    const publish = async () => {
      const revision = pendingVisualEditPublicationRevisionRef.current + 1;
      pendingVisualEditPublicationRevisionRef.current = revision;
      const pending =
        pendingEditCount > 0
          ? {
              designId: id,
              publisherId: pendingVisualEditPublisherIdRef.current,
              revision,
              pending: {
                designId: id,
                pendingEditCount,
                status: "ready" as const,
                prompt: pendingPrompt,
              },
            }
          : {
              designId: id,
              publisherId: pendingVisualEditPublisherIdRef.current,
              revision,
              pending: null,
            };
      if (pending.pending) {
        pendingVisualEditHandoffPublicationRef.current =
          updateVisualEditHandoffPublication(
            pendingVisualEditHandoffPublicationRef.current,
            { status: "queued", designId: id, publicationRevision: revision },
          );
        setPendingVisualEditHandoffServerRevision(null);
      }
      await runPublishVisualEditPending({
        activeScreenBridgeUrl,
        activeScreenPreviewToken,
        activeScreenLiveEditCapability,
        callAction,
        canPublishDurableHandoff: canEditDesign,
        designId: id,
        fetchImpl: fetch,
        pending,
        pendingVisualEditClearRequestedRef,
        pendingVisualEditHadPendingRef,
        prepareLocalBridgeRevision:
          bridgeRevisionSyncKey &&
          pendingVisualEditBridgeRevisionSyncKeyRef.current !==
            bridgeRevisionSyncKey
            ? async () => {
                const bridgeState = await readLocalVisualEditPendingState({
                  activeScreenBridgeUrl: activeScreenBridgeUrl!,
                  activeScreenPreviewToken: activeScreenPreviewToken!,
                  activeScreenLiveEditCapability:
                    activeScreenLiveEditCapability!,
                  designId: id,
                  fetchImpl: fetch,
                });
                const localRevision =
                  Math.max(revision - 1, bridgeState.revision) + 1;
                pendingVisualEditPublicationRevisionRef.current = Math.max(
                  pendingVisualEditPublicationRevisionRef.current,
                  localRevision,
                );
                pendingVisualEditBridgeRevisionSyncKeyRef.current =
                  bridgeRevisionSyncKey;
                return localRevision;
              }
            : undefined,
        onLocalRevisionConflict: () => {
          if (
            pendingVisualEditBridgeRevisionSyncKeyRef.current ===
            bridgeRevisionSyncKey
          ) {
            pendingVisualEditBridgeRevisionSyncKeyRef.current = null;
          }
        },
        onHandoffPublicationStatusChange: (
          status,
          publicationRevision,
          serverRevision,
        ) => {
          if (status === "ready") {
            if (typeof serverRevision !== "number") {
              setPendingVisualEditHandoffServerRevision(null);
              return;
            }
            const event = {
              status,
              designId: id,
              publicationRevision,
              serverRevision,
            };
            pendingVisualEditHandoffPublicationRef.current =
              updateVisualEditHandoffPublication(
                pendingVisualEditHandoffPublicationRef.current,
                event,
              );
            setPendingVisualEditHandoffServerRevision({
              designId: id,
              publicationRevision,
              serverRevision,
            });
            pendingVisualEditReloadedHandoffRef.current =
              updateReloadedVisualEditHandoff(
                pendingVisualEditReloadedHandoffRef.current,
                event,
              );
            clearReloadedPendingLiveEdits();
            return;
          }
          const event = { status, designId: id, publicationRevision };
          pendingVisualEditHandoffPublicationRef.current =
            updateVisualEditHandoffPublication(
              pendingVisualEditHandoffPublicationRef.current,
              event,
            );
          setPendingVisualEditHandoffServerRevision(null);
          pendingVisualEditReloadedHandoffRef.current =
            updateReloadedVisualEditHandoff(
              pendingVisualEditReloadedHandoffRef.current,
              event,
            );
          if (status === "local-ready") clearReloadedPendingLiveEdits();
        },
        setPendingVisualEditPublicationFailed,
        showHandoffErrorToast: (error) => {
          const errorCode = (error as { errorCode?: unknown } | undefined)
            ?.errorCode;
          toast.error(
            errorCode === "visual_edit_pending_conflict"
              ? t("designEditor.toasts.visualEditPendingConflict")
              : errorCode === "visual_edit_handoff_unconfirmed"
                ? t("designEditor.toasts.codingHandoffError")
                : (actionErrorMessage(error) ??
                  t("designEditor.toasts.codingHandoffError")),
            { id: "design-visual-edit-pending-publication" },
          );
        },
      });
    };
    pendingVisualEditPublicationQueueRef.current =
      pendingVisualEditPublicationQueueRef.current
        .catch((error) => {
          console.error(
            "[design:visual-edit] queued handoff publication failed",
            error,
          );
        })
        .then(publish);
  }, [
    activeScreenBridgeUrl,
    activeScreenPreviewToken,
    activeScreenLiveEditCapability,
    activeOverviewScreen?.id,
    canEditLiveScreen,
    canEditDesign,
    clearReloadedPendingLiveEdits,
    id,
    pendingVisualEditCount,
    pendingVisualStylePrompt,
    t,
  ]);
  useEffect(() => {
    if (
      !id ||
      !canEditDesign ||
      pendingVisualEditHadPendingRef.current !== id ||
      pendingVisualEditClearRequestedRef.current === id
    ) {
      return;
    }
    const localPendingCount =
      pendingVisualStyleEditsRef.current.length +
      pendingLiveNonStyleEditsRef.current.length;
    const handoffPublication = pendingVisualEditHandoffPublicationRef.current;
    const serverRevision =
      handoffPublication?.designId === id &&
      pendingVisualEditHandoffServerRevision?.designId === id &&
      pendingVisualEditHandoffServerRevision.publicationRevision ===
        handoffPublication.publicationRevision
        ? pendingVisualEditHandoffServerRevision.serverRevision
        : null;
    const handoff = pendingVisualEditHandoffQuery.data;
    if (
      !handoff ||
      !isVisualEditHandoffAcknowledged({
        serverRevision,
        expectedClientRevision:
          handoffPublication?.designId === id
            ? handoffPublication.publicationRevision
            : null,
        pendingEditCount: localPendingCount,
        revision: handoff.revision,
        publisherId: handoff.publisherId,
        clientRevision: handoff.clientRevision,
        expectedPublisherId: pendingVisualEditPublisherIdRef.current,
        status: handoff.status,
      })
    ) {
      return;
    }
    clearPendingLiveEditStateRef.current();
  }, [
    clearPendingLiveEditState,
    canEditDesign,
    id,
    pendingLiveNonStyleEdits,
    pendingVisualEditHandoffQuery.data,
    pendingVisualEditHandoffServerRevision,
    pendingVisualStyleEdits,
  ]);

  useEffect(() => {
    if (viewMode === "overview" && !motionDockOpen) return;
    if (!activeFile || !activeContent.trim()) return;
    const stamped = normalizeScreenHtml(activeContent, {
      source: {
        kind: "design-file",
        designId: id,
        fileId: activeFile.id,
        filename: activeFile.filename,
      },
    });
    if (!stamped.changed || stamped.content === activeContent) return;
    applyLocalContentUpdate(stamped.content, { recordHistory: false });
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    id,
    motionDockOpen,
    viewMode,
  ]);
  useEffect(() => {
    if (layersSearching) return;
    setCoveredLayerModelFileIds((covered) =>
      covered.size === 0 ? covered : new Set(),
    );
  }, [layersSearching]);
  useEffect(() => {
    if (!layersSearching || layerModelsCoverAll) return;
    let rankedQuery: string | null = null;
    let ranked: typeof historyFilesRef.current = [];
    let next = 0;
    return runInIdleSlices((deadline) => {
      const query = layersSearchQueryRef.current.trim();
      if (query !== rankedQuery) {
        rankedQuery = query;
        next = 0;
        // Screens whose source contains the query hold most text matches, so
        // they build first; the rest still build for name and type matches.
        const pattern = new RegExp(
          query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        );
        const uncovered = historyFilesRef.current.filter(
          (file) => !coveredLayerModelFileIdsRef.current.has(file.id),
        );
        const likely = uncovered.filter((file) =>
          pattern.test(getProjectionContentForScreenRef.current(file.id)),
        );
        ranked = [
          ...likely,
          ...uncovered.filter((file) => !likely.includes(file)),
        ];
      }
      const projected: string[] = [];
      while (next < ranked.length) {
        const file = ranked[next]!;
        next += 1;
        if (coveredLayerModelFileIdsRef.current.has(file.id)) continue;
        getCodeLayerProjectionForScreenRef.current(file.id);
        projected.push(file.id);
        if (performance.now() >= deadline) break;
      }
      if (projected.length > 0) {
        setCoveredLayerModelFileIds(
          (covered) => new Set([...covered, ...projected]),
        );
      }
      return next >= ranked.length;
    });
  }, [fileIdsKey, layerModelsCoverAll, layersSearching]);
  useEffect(() => {
    // Only the screens in use: a layer search builds every model, and pinning
    // all of them would hold each screen's parse outside the cache budget.
    pinCodeLayerDocuments(projectionPinOwner, [
      activeContent,
      ...recentLayerModelFileIdsRef.current.map(getProjectionContentForScreen),
    ]);
    return () => pinCodeLayerDocuments(projectionPinOwner, []);
  }, [
    activeContent,
    codeLayerModelsByFile,
    getProjectionContentForScreen,
    projectionPinOwner,
  ]);
  useEffect(() => {
    shouldPreserveBlockedOverviewLayerSelectionRef.current = (
      screenId: string,
    ) => {
      if (viewModeRef.current !== "overview") return false;
      return selectedLayerIdsState.some((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        if (!owner || owner.fileId !== screenId) return false;
        return (
          effectiveCodeLayerState.lockedIds.has(screenId) ||
          effectiveCodeLayerState.hiddenIds.has(screenId) ||
          effectiveCodeLayerState.lockedIds.has(layerId) ||
          effectiveCodeLayerState.hiddenIds.has(layerId)
        );
      });
    };
  }, [codeLayerOwnerByNodeId, effectiveCodeLayerState, selectedLayerIdsState]);
  useEffect(() => {
    const liveFileIds = new Set(files.map((file) => file.id));
    const builtStateByFileId = new Map(
      codeLayerModelsByFile.map((model) => [
        model.fileId,
        sourceLayerStateIds(model.fileId, model.projection),
      ]),
    );
    const reconcile = (current: Set<string>, kind: "hidden" | "locked") =>
      reconcileLayerStateIds({
        current,
        kind,
        liveFileIds,
        builtStateByFileId,
        overrides: layerStateOverridesRef.current,
      });
    setLockedLayerIds((current) => reconcile(current, "locked"));
    setHiddenLayerIds((current) => reconcile(current, "hidden"));
  }, [codeLayerModelsByFile, files]);

  const firstRunTemplatesQuery = useActionQuery(
    "list-design-templates",
    { includePreview: "true" },
    { enabled: canEditDesign && designIsEmpty },
  );
  const firstRunTemplates = useMemo(
    () =>
      (firstRunTemplatesQuery.data?.templates ?? []).map((template) => ({
        id: template.id,
        title: template.title,
        description: template.description,
        category: template.category,
        width: template.width,
        height: template.height,
        previewHtml: template.previewHtml,
        designSystemId: template.designSystemId,
        isBuiltIn: template.isBuiltIn,
      })),
    [firstRunTemplatesQuery.data?.templates],
  );
  const applyTemplate = useActionMutation("create-design-from-template");
  const handleFirstRunTemplate = useCallback(
    async (templateId: string) => {
      if (!id || applyingTemplateId) return;
      setApplyingTemplateId(templateId);
      try {
        await applyTemplate.mutateAsync({
          templateId,
          targetDesignId: id,
          ...(selectedPromptDesignSystemId
            ? { designSystemId: selectedPromptDesignSystemId }
            : {}),
        });
        await queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setApplyingTemplateId(null);
      }
    },
    [
      applyTemplate,
      applyingTemplateId,
      id,
      queryClient,
      selectedPromptDesignSystemId,
    ],
  );
  canEditSelectedLiveLayerRef.current = canEditSelectedLiveLayer;

  useLayoutEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);

  useEffect(() => {
    if (!id) return;
    if (initialUrlSelectionHydratedForIdRef.current === id) return;
    if (!initialRouteSelectionId) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    if (!resolvedInitialRouteSelectionId) return;
    if (
      selectedUrlSelectionId &&
      selectedUrlSelectionId !== resolvedInitialRouteSelectionId
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(resolvedInitialRouteSelectionId);
    if (!owner) return;
    if (viewModeRef.current === "single") {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const selectionBlocked =
      effectiveCodeLayerState.lockedIds.has(owner.fileId) ||
      effectiveCodeLayerState.hiddenIds.has(owner.fileId) ||
      effectiveCodeLayerState.lockedIds.has(resolvedInitialRouteSelectionId) ||
      effectiveCodeLayerState.hiddenIds.has(resolvedInitialRouteSelectionId);
    if (
      activeFileId === owner.fileId &&
      selectedLayerIds.includes(resolvedInitialRouteSelectionId) &&
      (selectionBlocked ||
        selectedElementLayerId === resolvedInitialRouteSelectionId)
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }

    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    explicitOverviewScreenSelectionRef.current = [];
    setActiveFileId(owner.fileId);
    setSelectedLayerIdsState([resolvedInitialRouteSelectionId]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    setSelectedElement(
      selectionBlocked ? null : elementInfoFromCodeLayerNode(owner.node),
    );
    setHoveredElement(null);
    setHoveredElementScreenId(null);
    setActiveTool("move");
    setMode("edit");
    if (!selectionBlocked) {
      focusDesignInspectorForSelection();
    }
    initialUrlSelectionHydratedForIdRef.current = id;
  }, [
    activeFileId,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    focusDesignInspectorForSelection,
    id,
    initialRouteSelectionId,
    selectedElementLayerId,
    selectedLayerIds,
    selectedUrlSelectionId,
    resolvedInitialRouteSelectionId,
  ]);

  useEffect(() => {
    if (!id || files.length === 0) return;
    const guardedInitialRouteScreenTarget = initialRouteScreenGuardRef.current;
    const currentScreenId = activeFileId ?? activeFile?.id;
    const initialRouteScreen = guardedInitialRouteScreenTarget
      ? findDesignFileByScreenTarget(files, guardedInitialRouteScreenTarget)
      : undefined;
    if (
      guardedInitialRouteScreenTarget &&
      !initialRouteScreen &&
      !activeFileId
    ) {
      return;
    }
    if (initialRouteScreen && currentScreenId !== initialRouteScreen.id) {
      return;
    }
    if (initialRouteScreen && currentScreenId === initialRouteScreen.id) {
      initialRouteScreenGuardRef.current = null;
    }
    const preserveInitialRouteSelection = Boolean(
      (resolvedInitialRouteSelectionId || initialRouteSelectionId) &&
      initialUrlSelectionHydratedForIdRef.current !== id &&
      resolvedInitialRouteSelectionId !== selectedUrlSelectionId &&
      codeLayerOwnerByNodeId.size === 0,
    );
    const nextSearch = getDesignEditorStateUrlSearch({
      currentSearch: location.search,
      viewMode,
      screenId: activeFileId ?? activeFile?.id,
      leftPanel: activeLeftPanel,
      codeFileId: activeLeftPanel === "code" ? activeCodeFile?.fileId : null,
      codeFilename: activeLeftPanel === "code" ? activeCodeFile?.path : null,
      selectionId:
        selectedUrlSelectionId ??
        (preserveInitialRouteSelection
          ? (resolvedInitialRouteSelectionId ?? initialRouteSelectionId)
          : null),
      zoom,
      tool: activeTool,
      mode,
    });
    const nextScreenId = activeFileId ?? activeFile?.id ?? null;
    const screenChanged =
      urlSyncScreenIdRef.current !== null &&
      nextScreenId !== urlSyncScreenIdRef.current;
    urlSyncScreenIdRef.current = nextScreenId;
    if (nextSearch === location.search) return;
    if (urlSyncTimerRef.current !== null) {
      window.clearTimeout(urlSyncTimerRef.current);
      urlSyncTimerRef.current = null;
    }
    if (screenChanged) {
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
          hash: location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
      return;
    }
    urlSyncTimerRef.current = window.setTimeout(() => {
      urlSyncTimerRef.current = null;
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
          hash: location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
    }, 150);
    return () => {
      if (urlSyncTimerRef.current !== null) {
        window.clearTimeout(urlSyncTimerRef.current);
        urlSyncTimerRef.current = null;
      }
    };
  }, [
    activeFile?.id,
    activeFileId,
    activeCodeFile?.fileId,
    activeCodeFile?.path,
    activeLeftPanel,
    activeTool,
    codeLayerOwnerByNodeId.size,
    files,
    id,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    initialRouteSelectionId,
    resolvedInitialRouteSelectionId,
    selectedUrlSelectionId,
    mode,
    viewMode,
    zoom,
  ]);

  useLayoutEffect(() => {
    selectedLayerTargetsRef.current = selectedLayerTargets;
  }, [selectedLayerTargets]);
  useEffect(() => {
    if (canvasBackground) return;
    // A throwaway element, not the raw token: the token is space-separated
    // HSL, which the colour parser rejects. After a frame, because next-themes
    // sets the `dark` class in an ancestor effect React runs after this one.
    const frame = requestAnimationFrame(() => {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;background-color:var(--design-editor-canvas-bg)";
      document.body.append(probe);
      const painted = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      setThemedCanvasBackground(painted || null);
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasBackground, resolvedTheme]);

  useEffect(() => {
    const pendingLayerId = pendingOverviewLayerSelectionRef.current;
    if (!pendingLayerId) return;
    if (!selectedLayerIdsState.includes(pendingLayerId)) {
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(pendingLayerId);
    if (!owner) return;
    schedulePendingOverviewLayerSelectionClear(pendingLayerId);
    setActiveFileId(owner.fileId);
    setSelectedElement(
      elementInfoForOwnedCodeLayerNode({
        info: selectedElementRef.current,
        node: owner.node,
        ownerFileId: owner.fileId,
      }),
    );
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      next.add(owner.fileId);
      collectCodeLayerAncestors(owner.tree, pendingLayerId).forEach((id) =>
        next.add(id),
      );
      return next.size === current.length ? current : Array.from(next);
    });
  }, [
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    schedulePendingOverviewLayerSelectionClear,
    selectedLayerIdsState,
  ]);

  useEffect(() => {
    selectionColorPreviewHistoryRef.current.clear();
    selectionColorPickerSessionRef.current.clear();
  }, [selectionColorScopeIdentity]);

  useEffect(
    () => () => {
      selectionColorPreviewHistoryRef.current.clear();
      selectionColorPickerSessionRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const pendingScreenId = pendingOverviewScreenSelectionRef.current;
    if (!pendingScreenId) return;
    if (files.some((file) => file.id === pendingScreenId)) {
      pendingOverviewScreenSelectionRef.current = null;
    }
  }, [files]);

  useEffect(() => {
    if (
      !selectedElementLayerId ||
      selectedLayerIdsStateRef.current.includes(selectedElementLayerId)
    ) {
      return;
    }
    setSelectedLayerIdsState((current) => {
      if (current.includes(selectedElementLayerId)) return current;
      if (current.length > 1) return [...current, selectedElementLayerId];
      return [selectedElementLayerId];
    });
  }, [selectedElementLayerId]);

  useEffect(() => {
    if (!selectedElementLayerId) return;
    const owner = codeLayerOwnerByNodeId.get(selectedElementLayerId);
    const ancestorIds = collectCodeLayerAncestors(
      owner?.tree ?? activeCodeLayerTree,
      selectedElementLayerId,
    );
    if (ancestorIds.length === 0) return;
    revealLayerIds(
      owner?.fileId ? [owner.fileId, ...ancestorIds] : ancestorIds,
    );
  }, [
    activeCodeLayerTree,
    codeLayerOwnerByNodeId,
    revealLayerIds,
    selectedElementLayerId,
  ]);

  useEffect(() => {
    const ids: string[] = [];
    for (const layerId of selectedLayerIds) {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (!owner) continue;
      ids.push(owner.fileId, ...collectCodeLayerAncestors(owner.tree, layerId));
    }
    if (ids.length > 0) revealLayerIds(ids);
  }, [codeLayerOwnerByNodeId, revealLayerIds, selectedLayerIds]);

  useEffect(() => {
    if (!selectedElementLayerId) return;
    const owner = codeLayerOwnerByNodeId.get(selectedElementLayerId);
    const selectedPathIds = [
      ...collectCodeLayerAncestors(
        owner?.tree ?? activeCodeLayerTree,
        selectedElementLayerId,
      ),
      selectedElementLayerId,
    ];
    const activeFileLocked =
      activeFile?.id && effectiveCodeLayerState.lockedIds.has(activeFile.id);
    const selectionBlocked =
      Boolean(activeFileLocked) ||
      selectedPathIds.some((layerId) =>
        effectiveCodeLayerState.lockedIds.has(layerId),
      );
    if (!selectionBlocked) return;
    setSelectedElement(null);
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    selectedElementLayerId,
  ]);

  const { data: activeLocalhostConnectionResult } = useActionQuery<{
    connections?: Array<{
      id: string;
      name?: string | null;
      devServerUrl?: string | null;
      rootPath?: string | null;
    }>;
  }>(
    "list-localhost-connections",
    { designId: id },
    {
      enabled: Boolean(id && canEditDesign),
    },
  );
  localhostConnectionRootPathByIdRef.current = new Map(
    (activeLocalhostConnectionResult?.connections ?? []).flatMap((connection) =>
      connection.rootPath
        ? ([[connection.id, connection.rootPath]] as Array<[string, string]>)
        : [],
    ),
  );
  const activeLocalhostConnectionRootPath =
    activeLocalhostConnectionResult?.connections?.find(
      (connection) => connection.id === activeLocalhostConnectionId,
    )?.rootPath ?? undefined;

  const componentRuntime = useMemo(() => {
    if (
      activeCanvasSourceType !== "localhost" ||
      !selectedComponentNodeId ||
      !selectedCodeLayerNode
    ) {
      return undefined;
    }
    const runtimeIdentity = selectedElement?.runtimeComponent;
    const name =
      selectedCodeLayerNode.dataAttributes[
        "data-agent-native-component"
      ]?.trim() ??
      runtimeIdentity?.name?.trim() ??
      selectedElement?.provenance?.component?.trim();
    if (!name) return undefined;

    const runtimeSource = selectedElement?.runtimeComponent;
    const sourceFile = runtimeSource?.sourceFile?.trim();
    const canWriteAuthoredJsx =
      runtimeIdentity?.writeCapability === "authored-jsx-literal";
    const local = canWriteAuthoredJsx
      ? selectedComponentLocalSource
      : undefined;

    return {
      name,
      nodeId: selectedComponentNodeId,
      selector:
        selectedElement?.runtimeSelector ??
        selectedElement?.selector ??
        selectedCodeLayerNode.selector,
      props: runtimeIdentity?.props?.length
        ? runtimeIdentity.props
        : extractProps(selectedCodeLayerNode),
      ...(selectedComponentLiteralProps
        ? { literalProps: selectedComponentLiteralProps }
        : {}),
      ...(runtimeIdentity?.componentId
        ? { componentId: runtimeIdentity.componentId }
        : {}),
      sourceLocation: sourceFile
        ? {
            filePath:
              selectedComponentLocalSource?.path ??
              projectRelativeSourcePath({
                sourceFile,
                rootPath: activeLocalhostConnectionRootPath,
              }) ??
              sourceFile,
            ...(runtimeSource?.name ? { exportName: runtimeSource.name } : {}),
          }
        : undefined,
      local,
    };
  }, [
    activeCanvasSourceType,
    activeLocalhostConnectionRootPath,
    selectedCodeLayerNode,
    selectedComponentNodeId,
    selectedElement,
    selectedComponentLiteralProps,
    selectedComponentLocalSource,
  ]);

  const requestLocalhostWrite = useCallback(
    (opts: {
      files: string[];
      onGranted: LocalhostWriteConsentPayload["onGranted"];
      onCancel?: () => void;
    }) => {
      if (!id || !canEditDesign) return;
      if (!activeLocalhostConnectionId) {
        toast.error(NO_LOCALHOST_CONNECTION_MESSAGE);
        return;
      }

      const rootPath =
        activeLocalhostConnectionRootPath ??
        activeScreenRouteSourceFile ??
        activeLocalhostConnectionId;

      setLocalhostConsentConnectionId(activeLocalhostConnectionId);
      setLocalhostWriteConsentPayload({
        rootPath,
        files: opts.files,
        onGranted: opts.onGranted,
        onCancel: opts.onCancel ?? (() => {}),
      });
      setLocalhostWriteConsentOpen(true);
    },
    [
      activeLocalhostConnectionId,
      activeLocalhostConnectionRootPath,
      activeScreenRouteSourceFile,
      canEditDesign,
      id,
    ],
  );
  requestLocalhostWriteRef.current = requestLocalhostWrite;

  const workbenchLocalhostConnections = useMemo(() => {
    const seen = new Map<
      string,
      { connectionId: string; label: string; rootPath?: string }
    >();
    for (const screen of overviewScreens) {
      if (screen.sourceType !== "localhost" || !screen.connectionId) continue;
      if (seen.has(screen.connectionId)) continue;
      let label = "Local app"; /* i18n-ignore */
      const screenUrl = screen.url ?? screen.previewUrl;
      if (screenUrl) {
        try {
          label = new URL(screenUrl).host || label;
          // coercion-ok: a malformed screen URL keeps the "Local app" label.
        } catch {
          // Keep the fallback label for malformed screen URLs.
        }
      }
      const rootPath = activeLocalhostConnectionResult?.connections?.find(
        (connection) => connection.id === screen.connectionId,
      )?.rootPath;
      const rootName = rootPath
        ?.replace(/[\\/]+$/, "")
        .split(/[\\/]+/)
        .pop();
      seen.set(screen.connectionId, {
        connectionId: screen.connectionId,
        label: rootName || label,
        rootPath: rootPath ?? undefined,
      });
    }
    return [...seen.values()];
  }, [activeLocalhostConnectionResult?.connections, overviewScreens]);

  const handleWorkbenchLocalWriteConsent = useCallback(
    (connectionId: string, retry: () => void, filePath?: string) => {
      if (!id || !canEditDesign) return;
      setLocalhostConsentConnectionId(connectionId);
      setLocalhostWriteConsentPayload({
        rootPath:
          workbenchLocalhostConnections.find(
            (connection) => connection.connectionId === connectionId,
          )?.rootPath ??
          workbenchLocalhostConnections.find(
            (connection) => connection.connectionId === connectionId,
          )?.label ??
          connectionId,
        files: filePath ? [filePath] : [],
        onGranted: () => retry(),
        onCancel: () => {},
      });
      setLocalhostWriteConsentOpen(true);
    },
    [canEditDesign, id, workbenchLocalhostConnections],
  );

  return {
    frameToolDraws,
    setFrameToolDraws,
    handleFrameTool,
    handleTextTool,
    handlePenTool,
    handleHandTool,
    handleScaleTool,
    handleDrawTool,
    handleBooleanSubtractSelection,
    pendingVisualStyleNavigationBlocker,
    importPanelRef,
    setPendingImportFile,
    skipPendingEditNavigationBlockRef,
    handleStayOnPendingVisualStyleNavigation,
    handleDiscardPendingVisualStylesAndNavigate,
    firstRunTemplatesQuery,
    firstRunTemplates,
    applyingTemplateId,
    handleFirstRunTemplate,
    activeLocalhostConnectionId,
    activeLocalhostConnectionResult,
    componentRuntime,
    requestLocalhostWrite,
    workbenchLocalhostConnections,
    handleWorkbenchLocalWriteConsent,
  };
}

export type EditorSourceAndSync = ReturnType<typeof useEditorSourceAndSync>;

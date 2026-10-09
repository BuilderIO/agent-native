import {
  RemoteSelectionRings,
  RecentEditHighlights,
} from "@agent-native/toolkit/collab-ui";

import { shouldRenderOverviewReviewCanvas } from "@/components/design/multi-screen/board-surface-html";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { ReviewCanvasPins } from "@/components/visual-editor";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorClipboard } from "../domains/use-editor-clipboard";
import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorEditCommands } from "../domains/use-editor-edit-commands";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayerActions } from "../domains/use-editor-layer-actions";
import type { EditorLayerModels } from "../domains/use-editor-layer-models";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorModes } from "../domains/use-editor-modes";
import type { EditorScreenChangeHandlers } from "../domains/use-editor-screen-change-handlers";
import type { EditorScreenInspector } from "../domains/use-editor-screen-inspector";
import type { EditorScreenRendering } from "../domains/use-editor-screen-rendering";
import type { EditorSelectionAndStyles } from "../domains/use-editor-selection-and-styles";
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";
import type { EditorToolsAndVectors } from "../domains/use-editor-tools-and-vectors";
import { findDesignFileByScreenTarget } from "../screen-command-utils";
import type { DesignData } from "../types";

export function renderOverviewCanvas({
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
  editorEditCommands,
  editorModes,
  editorExportAndHandoff,
  editorLayerModels,
  editorScreenInspector,
  editorLayerActions,
  editorSourceAndSync,
  editorScreenRendering,
  id,
  design,
  hasExplicitOverviewZoomCommand,
  hoveredElementIsScreenRoot,
  hoveredScreenRootId,
  hoveredChildScreenId,
  overviewScreenContentRenderKey,
  chromeInsetLeft,
  chromeInsetRight,
  selectedPenPathNodeId,
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
  editorEditCommands: EditorEditCommands;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerModels: EditorLayerModels;
  editorScreenInspector: EditorScreenInspector;
  editorLayerActions: EditorLayerActions;
  editorSourceAndSync: EditorSourceAndSync;
  editorScreenRendering: EditorScreenRendering;
  id: string;
  design: DesignData;
  hasExplicitOverviewZoomCommand: boolean;
  hoveredElementIsScreenRoot: boolean;
  hoveredScreenRootId: string | null;
  hoveredChildScreenId: string | null;
  overviewScreenContentRenderKey: string;
  chromeInsetLeft: number;
  chromeInsetRight: number;
  selectedPenPathNodeId: string | null;
}) {
  const {
    overviewInteractScreenId,
    widgetEmbed,
    activeFileId,
    mode,
    hoveredElement,
    activeTool,
    session,
    handleOverviewPrimaryContentHeightChange,
    runtimeStructureInsertRequest,
    runtimeStructurePendingTransactionRef,
  } = editorCore;
  const {
    overviewSelectedScreenIds,
    hiddenLayerIds,
    lockedLayerIds,
    handleLiveScreenRuntimeReload,
  } = editorHistory;
  const {
    canEditDesign,
    pinMode,
    canCommentDesign,
    reviewSendingThreadId,
    publicVisualEdit,
    addBreakpointMutation,
    removeBreakpointMutation,
    updateBreakpointMutation,
  } = editorGenerationAndAccess;
  const {
    overviewScreens,
    files,
    pendingNodeRewriteScreenIds,
    displayedCanvasFrameGeometryById,
    optimisticFrameGeometryById,
    boardFileId,
    codeLayerSourceForScreen,
    editorPreferences,
    layoutGrids,
    screenRootComputedStylesById,
    liveScreenSnapshotsById,
    cssVarValues,
  } = editorFilesAndSaving;
  const {
    overviewCanvasZoom,
    setExplicitOverviewCanvasZoom,
    cameraCommand,
    explicitOverviewCanvasZoom,
    interactDeviceSize,
    deviceFrame,
    queueFrameGeometrySave,
    handleGeometryCommit,
    handleOverviewBreakpointContentHeightChange,
    handleOverviewScreenContentNaturalHeightChange,
    boardFileContent,
    handleOverviewRemoveBreakpoint,
  } = editorActiveScreenAndGeometry;
  const {
    suppressLineupRecenter,
    hoveredElementScreenId,
    overviewClearSelectionRequest,
    handleCreateScreenFrame,
    handleDuplicateScreen,
  } = editorCanvasAndScreens;
  const {
    overviewAgentOthers,
    resolveOverviewSelectionRect,
    canvasContainerRef,
    overviewRecentEditsForOverlays,
    resolveOverviewRecentEditRect,
  } = editorLiveEditsAndPresence;
  const {
    handleOverviewPrimitiveReparent,
    hoveredCanvasSelector,
    hoveredCanvasSelectorCandidates,
  } = editorContentAndComponents;
  const {
    reviewFocusRequest,
    handleDispatchCommentToAgent,
    handleSendReviewThreadToAgent,
    handleOverviewActiveToolChange,
    handleOverviewScreenSelectionChange,
    vectorEditOverlayState,
    handleCreatePrimitive,
    handlePrimitiveCreated,
    handleUpdatePenPath,
    handleBoardDrawPrimitive,
    handleOverviewScreenPick,
    handleOverviewScreenGestureSelect,
  } = editorToolsAndVectors;
  const { handleIframeContextMenu } = editorSelectionAndStyles;
  const {
    handleBoardVisualStyleChange,
    handleBoardVisualStructureChange,
    handleBoardVisualDuplicateChange,
    handleBoardTextContentChange,
  } = editorScreenChangeHandlers;
  const {
    visibleCanvasRectRef,
    handleOverviewDropFiles,
    handleBoardSelectionWorldBoundsChange,
    handleCanvasFigmaClipboardPaste,
    handleCanvasImagePaste,
  } = editorClipboard;
  const {
    commentsHidden,
    viewSettings: { pixelGrid, snapToPixelGrid, rulers },
    handleCrossScreenElementDrop,
    boardFrameGeometry,
    runtimeStructureRollbackRequest,
    handleRuntimeStructureInsertRejected,
    handleRuntimeStructureInsertApplied,
  } = editorLayoutAndStructure;
  const {
    handleRuntimeStructureRollbackResult,
    handleDeleteOverviewSelection,
    handleOverviewNudgeSelection,
  } = editorEditCommands;
  const {
    responsiveInteractActive,
    interactZoom,
    handleReviewPendingScreen,
    handleExitReviewCommentMode,
    handleOverviewCommentPin,
    handleOverviewFrameAction,
    handleOverviewEditBreakpoint,
    overviewCommentPinRequest,
  } = editorModes;
  const { exportPreviewScreenId, overviewSelectAllRequest } =
    editorExportAndHandoff;
  const {
    initialRouteScreenTarget,
    selectedElementScreenId,
    selectedBoardCanvasSelectorCandidates,
    selectedBoardCanvasSourceId,
    getLayerSelectorsForFile,
    selectedLayerSelectorGroupsByScreen,
  } = editorLayerModels;
  const { canvasBackground } = editorScreenInspector;
  const {
    fullViewScreenIds,
    editableLiveScreenIds,
    gradientEditTarget,
    handleBoardElementMarqueeSelect,
    handleCanvasLayerMarqueeSelectionChange,
  } = editorLayerActions;
  const { frameToolDraws } = editorSourceAndSync;
  const {
    handleBoardElementSelect,
    handleBoardElementHover,
    handleBoardElementClear,
    handleIframeHotkey,
    handleBoardTextEditingStateChange,
    handleBoardElementDblClickText,
    handleBoardVisualStyleBatchChange,
    handleOverviewAddBreakpoint,
    handleOverviewActiveBreakpointChange,
    handleOverviewChangeBreakpointWidth,
    renderScreenContent,
    renderBreakpointContent,
  } = editorScreenRendering;

  return (
    <>
      <MultiScreenCanvas
        screens={overviewScreens}
        zoom={
          responsiveInteractActive && overviewInteractScreenId
            ? interactZoom
            : overviewCanvasZoom
        }
        camera={{
          onZoomChange:
            responsiveInteractActive && overviewInteractScreenId
              ? undefined
              : setExplicitOverviewCanvasZoom,
          cameraCommand,
          suppressLineupRecenter,
          preserveCameraOnScreenCountChange:
            explicitOverviewCanvasZoom !== null,
          deferLineupZoomChange:
            hasExplicitOverviewZoomCommand &&
            explicitOverviewCanvasZoom === null,
          initialFitScreenId: widgetEmbed
            ? (findDesignFileByScreenTarget(files, initialRouteScreenTarget)
                ?.id ?? null)
            : undefined,
          fitFocusedViewport: widgetEmbed,
          chromeInsetLeft,
          chromeInsetRight,
          visibleCanvasRectRef,
        }}
        activeId={activeFileId}
        selection={{
          selectedScreenIds: overviewSelectedScreenIds,
          selectedElementScreenId,
          selectedPenPathNodeId,
          activeScreenHasHoveredChild:
            Boolean(hoveredElement) &&
            !hoveredElementIsScreenRoot &&
            hoveredElementScreenId === activeFileId,
          hoveredChildScreenId,
          directlyHoveredScreenId: hoveredScreenRootId,
          selectAllRequest: overviewSelectAllRequest,
          clearSelectionRequest: overviewClearSelectionRequest,
          onScreenSelectionChange: handleOverviewScreenSelectionChange,
          onSelectionChange: handleOverviewScreenSelectionChange,
          onLayerMarqueeSelectionChange:
            handleCanvasLayerMarqueeSelectionChange,
          selectedLayerSelectorGroupsByScreen,
        }}
        exportPreviewScreenId={exportPreviewScreenId}
        hiddenScreenIds={hiddenLayerIds}
        lockedScreenIds={lockedLayerIds}
        fullViewScreenIds={fullViewScreenIds}
        pixelGridEnabled={pixelGrid}
        snapToPixelGrid={snapToPixelGrid}
        showRulers={rulers}
        review={{
          pendingReviewScreenIds: pendingNodeRewriteScreenIds,
          onReviewPendingScreen: handleReviewPendingScreen,
          reviewResourceId: id,
          reviewPinMode: pinMode,
          reviewCommentsHidden: commentsHidden,
          reviewCanPost: canCommentDesign,
          reviewCanResolve: canEditDesign,
          reviewTargetId: null,
          reviewCurrentUserEmail: session?.email,
          reviewFocusRequest,
          onExitReviewPinMode: handleExitReviewCommentMode,
          onDispatchCommentToAgent: handleDispatchCommentToAgent,
          onSendThreadToAgent: handleSendReviewThreadToAgent,
          reviewSendingThreadId,
          reviewDesignTitle: design?.title,
          onCommentPin: canCommentDesign ? handleOverviewCommentPin : undefined,
        }}
        interactMode={mode === "interact" && !overviewInteractScreenId}
        interactScreenId={
          responsiveInteractActive ? overviewInteractScreenId : null
        }
        focusedInteractViewport={
          responsiveInteractActive && overviewInteractScreenId
            ? interactDeviceSize
            : null
        }
        readOnly={!canEditDesign}
        editableScreenIds={editableLiveScreenIds}
        previewDeviceFrame={deviceFrame}
        creation={{
          activeTool,
          onActiveToolChange: handleOverviewActiveToolChange,
          gradientEditTarget,
          vectorEdit: vectorEditOverlayState,
          onCreatePrimitive: handleCreatePrimitive,
          onPrimitiveCreated: handlePrimitiveCreated,
          onUpdatePenPath: canEditDesign ? handleUpdatePenPath : undefined,
          onPrimitiveReparent: handleOverviewPrimitiveReparent,
          onCreateScreenFrame: handleCreateScreenFrame,
          frameToolDraws,
        }}
        onScreenRuntimeReload={handleLiveScreenRuntimeReload}
        geometry={{
          geometryById: displayedCanvasFrameGeometryById,
          geometryOverridesById: optimisticFrameGeometryById,
          onGeometryChange: queueFrameGeometrySave,
          onGeometryCommit: handleGeometryCommit,
          onPrimaryContentHeightChange:
            handleOverviewPrimaryContentHeightChange,
          onScreenContentNaturalHeightChange:
            handleOverviewScreenContentNaturalHeightChange,
          onNudgeSelection: handleOverviewNudgeSelection,
          nudgeAmounts: editorPreferences.nudge,
          layoutGrids,
        }}
        breakpoints={{
          onBreakpointContentHeightChange:
            handleOverviewBreakpointContentHeightChange,
          onAddBreakpoint: widgetEmbed
            ? undefined
            : handleOverviewAddBreakpoint,
          breakpointMutationPending:
            addBreakpointMutation.isPending ||
            removeBreakpointMutation.isPending ||
            updateBreakpointMutation.isPending,
          onActiveBreakpointChange: handleOverviewActiveBreakpointChange,
          onRemoveBreakpoint: canEditDesign
            ? handleOverviewRemoveBreakpoint
            : undefined,
          onChangeBreakpointWidth: canEditDesign
            ? handleOverviewChangeBreakpointWidth
            : undefined,
          onEditBreakpoint: handleOverviewEditBreakpoint,
          renderBreakpointContent,
        }}
        onCrossScreenElementDrop={handleCrossScreenElementDrop}
        onDropFiles={canEditDesign ? handleOverviewDropFiles : undefined}
        board={{
          boardFileId,
          boardCodeLayerSource: boardFileId
            ? codeLayerSourceForScreen(boardFileId)
            : undefined,
          boardIsActive: activeFileId === boardFileId,
          boardFileContent,
          boardFrameGeometry,
          boardRuntimeStructureInsertRequest:
            runtimeStructureInsertRequest?.screenId === boardFileId
              ? runtimeStructureInsertRequest
              : null,
          boardRuntimeStructureRollbackRequest:
            runtimeStructureRollbackRequest?.screenId === boardFileId
              ? runtimeStructureRollbackRequest
              : null,
          runtimeStructurePendingTransactionRef,
          onBoardRuntimeStructureInsertRejected:
            handleRuntimeStructureInsertRejected,
          onBoardRuntimeStructureInsertApplied:
            handleRuntimeStructureInsertApplied,
          onBoardRuntimeStructureRollbackResult:
            handleRuntimeStructureRollbackResult,
          boardClearSelectionRequest: overviewClearSelectionRequest,
          boardSelectedSelector:
            selectedBoardCanvasSelectorCandidates[0] ?? null,
          boardSelectedSelectorCandidates:
            selectedBoardCanvasSelectorCandidates,
          boardSelectedSourceId: selectedBoardCanvasSourceId,
          boardHoveredSelector:
            hoveredElementScreenId === boardFileId
              ? hoveredCanvasSelector
              : null,
          boardHoveredSelectorCandidates:
            hoveredElementScreenId === boardFileId
              ? hoveredCanvasSelectorCandidates
              : undefined,
          boardLockedSelectors: boardFileId
            ? getLayerSelectorsForFile(boardFileId, lockedLayerIds)
            : undefined,
          boardHiddenSelectors: boardFileId
            ? getLayerSelectorsForFile(boardFileId, hiddenLayerIds)
            : undefined,
          onBoardDrawPrimitive: canEditDesign
            ? handleBoardDrawPrimitive
            : undefined,
          boardEditMode: canEditDesign || publicVisualEdit,
          onBoardElementSelect: boardFileId
            ? handleBoardElementSelect
            : undefined,
          onBoardSelectionWorldBoundsChange: boardFileId
            ? handleBoardSelectionWorldBoundsChange
            : undefined,
          onBoardElementMarqueeSelect: boardFileId
            ? handleBoardElementMarqueeSelect
            : undefined,
          onBoardElementHover: boardFileId
            ? handleBoardElementHover
            : undefined,
          onBoardElementClear: boardFileId
            ? handleBoardElementClear
            : undefined,
          onBoardIframeHotkey: handleIframeHotkey,
          onBoardFigmaClipboardPaste: handleCanvasFigmaClipboardPaste,
          onBoardImagePaste: handleCanvasImagePaste,
          onBoardIframeContextMenu: handleIframeContextMenu,
          onBoardTextEditingStateChange: handleBoardTextEditingStateChange,
          onBoardElementDblClickText: boardFileId
            ? handleBoardElementDblClickText
            : undefined,
          onBoardVisualStyleChange: boardFileId
            ? handleBoardVisualStyleChange
            : undefined,
          onBoardVisualStyleBatchChange: boardFileId
            ? handleBoardVisualStyleBatchChange
            : undefined,
          onBoardVisualStructureChange: boardFileId
            ? handleBoardVisualStructureChange
            : undefined,
          onBoardVisualDuplicateChange: boardFileId
            ? handleBoardVisualDuplicateChange
            : undefined,
          onBoardTextContentChange: boardFileId
            ? handleBoardTextContentChange
            : undefined,
        }}
        canvasBackground={canvasBackground}
        onDeleteSelection={handleDeleteOverviewSelection}
        screenRootComputedStylesById={screenRootComputedStylesById}
        onPick={handleOverviewScreenPick}
        onSelectForGesture={handleOverviewScreenGestureSelect}
        onEdit={handleOverviewFrameAction}
        onDuplicate={handleDuplicateScreen}
        renderScreenContent={renderScreenContent}
        screenContentRenderKey={overviewScreenContentRenderKey}
        screenSnapshotsById={liveScreenSnapshotsById}
        tweakValues={cssVarValues}
      />
      {id &&
      shouldRenderOverviewReviewCanvas({
        boardFileId,
        boardFileContent,
      }) ? (
        <ReviewCanvasPins
          active={pinMode}
          hidden={commentsHidden}
          onClose={handleExitReviewCommentMode}
          canvasSelector="[data-multi-screen-canvas-surface]"
          showPlacementPlane={false}
          resourceType="design"
          resourceId={id}
          targetId={null}
          pinRequest={overviewCommentPinRequest}
          canPost={canCommentDesign}
          canResolve={canEditDesign}
          focusRequest={reviewFocusRequest}
          onDispatchCommentToAgent={
            canEditDesign ? handleDispatchCommentToAgent : undefined
          }
          onSendThreadToAgent={
            canEditDesign ? handleSendReviewThreadToAgent : undefined
          }
          sendingThreadId={reviewSendingThreadId}
        />
      ) : null}
      {/* §6.4 — the compact/full breakpoint bar itself now
                          renders as a non-overlapping chrome row ABOVE
                          canvasContainerRef (see the shared block right
                          before that div's opening tag), not here. */}
      {/* Presence (overview): the agent's selection ring +
                        fading recent-edit highlights, resolved element-level
                        inside the frame it is editing and positioned over the
                        board. See overview presence pipeline above. */}
      {overviewAgentOthers.length > 0 && (
        <RemoteSelectionRings
          others={overviewAgentOthers}
          resolveRect={resolveOverviewSelectionRect}
          containerRef={canvasContainerRef}
        />
      )}
      {overviewRecentEditsForOverlays.length > 0 && (
        <RecentEditHighlights
          edits={overviewRecentEditsForOverlays}
          resolveRect={resolveOverviewRecentEditRect}
          containerRef={canvasContainerRef}
        />
      )}
    </>
  );
}

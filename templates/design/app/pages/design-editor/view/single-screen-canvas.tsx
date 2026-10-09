import {
  RemoteSelectionRings,
  RecentEditHighlights,
  LiveCursorOverlay,
} from "@agent-native/toolkit/collab-ui";

import { DesignCanvas } from "@/components/design/DesignCanvas";
import { prettyScreenName } from "@/lib/screen-names";

import type { CreationTool } from "../../../components/design/design-canvas/creation";
import { previewUrlAtLiveRoute } from "../design-editor-shared";
import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorClipboard } from "../domains/use-editor-clipboard";
import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorEditCommands } from "../domains/use-editor-edit-commands";
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
import type { EditorToolsAndVectors } from "../domains/use-editor-tools-and-vectors";
import type { DesignData } from "../types";

export function renderSingleScreenCanvas({
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
  editorLayerModels,
  editorScreenInspector,
  editorLayerActions,
  editorScreenRendering,
  id,
  design,
  activeScreenLayoutGridStep,
  activeScreenLiveEditRegistrationCapability,
  activeScreenExternalSnapshotHtml,
  activeSingleScreenCreationTool,
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
  editorLayerModels: EditorLayerModels;
  editorScreenInspector: EditorScreenInspector;
  editorLayerActions: EditorLayerActions;
  editorScreenRendering: EditorScreenRendering;
  id: string;
  design: DesignData;
  activeScreenLayoutGridStep: number;
  activeScreenLiveEditRegistrationCapability: string | undefined;
  activeScreenExternalSnapshotHtml: string | undefined;
  activeSingleScreenCreationTool: CreationTool | null;
  selectedPenPathNodeId: string | null;
}) {
  const {
    pendingVisualStyleRevertRequest,
    pendingVisualStyleBaselineResetRequest,
    pendingTextRevertRequest,
    pendingStructureAckRequest,
    runtimeStructureInsertRequest,
    runtimeStructureVerificationRequest,
    liveRoutePathsByScreenIdRef,
    handleLiveRoutePathChange,
    mode,
    activeTool,
    setActiveTool,
    setSelectedElement,
    setHoveredElement,
    handleTextEditingStateChangeForScreen,
    session,
    t,
  } = editorCore;
  const {
    pendingVisualStyleEdits,
    activeBreakpointWidthState,
    shaderFillPreview,
    explicitOverviewScreenSelectionRef,
    setSelectedLayerIdsState,
  } = editorHistory;
  const {
    runtimeLayerSnapshotRequest,
    publicVisualEdit,
    canEditDesign,
    liveCollaborationEnabled,
    reserveVisualEditSnapshot,
    handleComponentSourceJump,
    drawMode,
    handleFocusedAnnotationSendingChange,
    pinMode,
    canCommentDesign,
    reviewSendingThreadId,
  } = editorGenerationAndAccess;
  const {
    remoteVisualEditPending,
    handleScreenExternalContentSnapshot,
    cssVarValues,
    files,
  } = editorFilesAndSaving;
  const {
    activeFile,
    setZoom,
    deviceFrame,
    activeCanvasSourceType,
    activeScreenSnapshotOnly,
    activeScreenBridgeUrl,
    activeOverviewScreen,
    activeScreenPreviewToken,
    activeScreenLiveEditCapability,
    handleEffectivePreviewTokenChange,
    handleLiveEditCapabilityChange,
    handleLiveEditRegistrationCapabilityChange,
    handleActiveScreenRuntimeReload,
    interactDeviceSize,
  } = editorActiveScreenAndGeometry;
  const {
    activeContent,
    getRuntimeLayerSnapshotReadinessCallback,
    overviewClearSelectionRequest,
    handleEditorDragStateChange,
    setHoveredElementScreenId,
    setOverviewClearSelectionRequest,
    resolveSelectionRect,
    resolveRecentEditRect,
  } = editorCanvasAndScreens;
  const {
    contentRenderRevision,
    zoom,
    activeRuntimeProjectionEligible,
    handleActiveRuntimeLayerSnapshot,
    handleActiveRuntimeVerificationSnapshot,
    designFusionUrl,
    motionTracksWire,
    motionDefaultEase,
    motionDurationMs,
    selectedCanvasSelector,
    selectedCanvasSelectorCandidates,
    others,
    othersForOverlays,
    canvasContainerRef,
    recentEditsForOverlays,
    othersWithAgentCursor,
  } = editorLiveEditsAndPresence;
  const { hoveredCanvasSelector, hoveredCanvasSelectorCandidates } =
    editorContentAndComponents;
  const {
    spacePanActive,
    handleSingleScreenCreatePrimitive,
    handleUpdatePenPath,
    handleExitFocusedDrawMode,
    focusedAnnotationResetSignal,
    reviewFocusRequest,
    handleDispatchCommentToAgent,
    handleSendReviewThreadToAgent,
  } = editorToolsAndVectors;
  const {
    canEditActiveVisualScreen,
    handleElementSelect,
    handleElementHover,
    handleIframeContextMenu,
    handleTextContentChange,
    handleElementDblClickText,
    repromptDraftRequest,
    handleRepromptDraftConsumed,
  } = editorSelectionAndStyles;
  const {
    handleVisualStyleChange,
    handleVisualStructureChange,
    handleVisualDuplicateChange,
  } = editorScreenChangeHandlers;
  const {
    handleSingleScreenDropFiles,
    handleCanvasFigmaClipboardPaste,
    handleCanvasImagePaste,
  } = editorClipboard;
  const {
    runtimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
    handleRuntimeStructureInsertRejected,
    handleRuntimeStructureInsertApplied,
    handleRuntimeStructureDeleteApplied,
    handleRuntimeStructureDeleteRejected,
    commentsHidden,
    viewSettings: { pixelGrid, multiplayerCursors },
  } = editorLayoutAndStructure;
  const {
    runtimeStructureMoveRequest,
    runtimeLayerRenameForScreen,
    handleRuntimeStructureRollbackResult,
    handleRuntimeLayerRenameApplied,
  } = editorEditCommands;
  const {
    responsiveInteractActive,
    interactZoom,
    handleExitReviewCommentMode,
    handleModeChange,
  } = editorModes;
  const {
    selectedLayerSelectorGroupsByScreen,
    lockedLayerSelectors,
    hiddenLayerSelectors,
  } = editorLayerModels;
  const { activeScreenPreviewUrl } = editorScreenInspector;
  const {
    inScreenGradientEditTarget,
    handleInScreenGradientEditChange,
    statePreviewTarget,
    handleElementMarqueeSelect,
  } = editorLayerActions;
  const { handleIframeHotkey, handleKScaleStyleBatchChange } =
    editorScreenRendering;

  const visibleCursorOthers = multiplayerCursors
    ? othersWithAgentCursor
    : othersWithAgentCursor.filter((other) => other.isAgent);

  return (
    <>
      <DesignCanvas
        screenId={activeFile.id}
        layoutGridStep={activeScreenLayoutGridStep}
        content={activeContent}
        contentKey={`${activeFile.id}:${contentRenderRevision}`}
        styleRevertRequest={
          pendingVisualStyleRevertRequest
            ? {
                requestId: pendingVisualStyleRevertRequest.requestId,
                patches: pendingVisualStyleRevertRequest.patches.filter(
                  (patch) => patch.screenId === activeFile.id,
                ),
              }
            : null
        }
        pendingStylePreviewPatches={pendingVisualStyleEdits}
        styleBaselineResetRequest={pendingVisualStyleBaselineResetRequest}
        textRevertRequest={
          pendingTextRevertRequest
            ? {
                requestId: pendingTextRevertRequest.requestId,
                patches: pendingTextRevertRequest.patches.filter(
                  (patch) => patch.screenId === activeFile.id,
                ),
              }
            : null
        }
        structureAckRequest={
          pendingStructureAckRequest
            ? {
                requestId: pendingStructureAckRequest.requestId,
                acks: pendingStructureAckRequest.acks.filter(
                  (ack) => ack.screenId === activeFile.id,
                ),
              }
            : null
        }
        runtimeStructureMoveRequest={
          runtimeStructureMoveRequest?.screenId === activeFile.id
            ? runtimeStructureMoveRequest
            : null
        }
        runtimeStructureInsertRequest={
          runtimeStructureInsertRequest?.screenId === activeFile.id
            ? runtimeStructureInsertRequest
            : null
        }
        runtimeStructureDeleteRequest={
          runtimeStructureDeleteRequest?.screenId === activeFile.id
            ? runtimeStructureDeleteRequest
            : null
        }
        runtimeStructureRollbackRequest={
          runtimeStructureRollbackRequest?.screenId === activeFile.id
            ? runtimeStructureRollbackRequest
            : null
        }
        runtimeStructureTargetTransactionId={
          runtimeStructureDeleteRequest?.rollbackScreenId === activeFile.id
            ? runtimeStructureDeleteRequest.transactionId
            : null
        }
        runtimeLayerRenameRequest={runtimeLayerRenameForScreen(activeFile.id)}
        runtimeLayerSnapshotRequest={runtimeLayerSnapshotRequest}
        onRuntimeStructureInsertRejected={handleRuntimeStructureInsertRejected}
        onRuntimeStructureInsertApplied={handleRuntimeStructureInsertApplied}
        onRuntimeStructureDeleteApplied={handleRuntimeStructureDeleteApplied}
        onRuntimeStructureDeleteRejected={handleRuntimeStructureDeleteRejected}
        onRuntimeStructureRollbackResult={handleRuntimeStructureRollbackResult}
        onRuntimeLayerRenameApplied={(details) =>
          handleRuntimeLayerRenameApplied(activeFile.id, details)
        }
        runtimeVerificationRequest={
          runtimeStructureVerificationRequest?.screenIds.includes(activeFile.id)
            ? {
                requestId: runtimeStructureVerificationRequest.requestId,
              }
            : null
        }
        zoom={responsiveInteractActive ? interactZoom : zoom}
        pixelGridEnabled={pixelGrid}
        onZoomChange={responsiveInteractActive ? undefined : setZoom}
        deviceFrame={deviceFrame}
        sourceType={activeCanvasSourceType}
        previewUrlOverride={
          !activeScreenSnapshotOnly && activeCanvasSourceType === "localhost"
            ? previewUrlAtLiveRoute(
                activeScreenPreviewUrl ?? undefined,
                liveRoutePathsByScreenIdRef.current[activeFile.id],
              )
            : undefined
        }
        previewUrlSourceKey={`${activeFile.id}:${activeScreenPreviewUrl ?? ""}`}
        bridgeUrl={activeScreenBridgeUrl}
        connectionId={
          activeScreenSnapshotOnly
            ? undefined
            : activeOverviewScreen?.connectionId
        }
        previewToken={activeScreenPreviewToken}
        liveEditCapability={
          activeScreenSnapshotOnly ? undefined : activeScreenLiveEditCapability
        }
        liveEditRegistrationCapability={
          activeScreenSnapshotOnly
            ? undefined
            : activeScreenLiveEditRegistrationCapability
        }
        onPreviewTokenChange={
          activeScreenSnapshotOnly
            ? undefined
            : handleEffectivePreviewTokenChange
        }
        onLiveEditCapabilityChange={
          activeScreenSnapshotOnly ? undefined : handleLiveEditCapabilityChange
        }
        onLiveEditRegistrationCapabilityChange={
          activeScreenSnapshotOnly
            ? undefined
            : handleLiveEditRegistrationCapabilityChange
        }
        onRoutePathChange={
          activeScreenSnapshotOnly ? undefined : handleLiveRoutePathChange
        }
        onRuntimeReload={handleActiveScreenRuntimeReload}
        publicVisualEdit={!activeScreenSnapshotOnly && publicVisualEdit}
        externalSnapshotHtml={
          activeScreenSnapshotOnly
            ? undefined
            : activeScreenExternalSnapshotHtml
        }
        snapshotOnly={activeScreenSnapshotOnly}
        blockPreviewInteraction={remoteVisualEditPending && mode === "interact"}
        onExternalContentSnapshot={
          activeScreenSnapshotOnly
            ? undefined
            : (snapshot) => {
                if (!activeFile?.id) return;
                handleScreenExternalContentSnapshot(activeFile.id, snapshot);
              }
        }
        onRuntimeLayerSnapshot={
          activeRuntimeProjectionEligible
            ? handleActiveRuntimeLayerSnapshot
            : undefined
        }
        onRuntimeLayerSnapshotReadinessChange={
          activeRuntimeProjectionEligible
            ? getRuntimeLayerSnapshotReadinessCallback(activeFile.id)
            : undefined
        }
        onReserveVisualEditSnapshot={
          !activeScreenSnapshotOnly &&
          canEditDesign &&
          liveCollaborationEnabled &&
          id &&
          activeCanvasSourceType === "localhost"
            ? reserveVisualEditSnapshot
            : undefined
        }
        onRuntimeVerificationSnapshot={
          runtimeStructureVerificationRequest?.screenIds.includes(activeFile.id)
            ? handleActiveRuntimeVerificationSnapshot
            : undefined
        }
        fusionUrl={designFusionUrl}
        previewWidthPx={
          responsiveInteractActive
            ? interactDeviceSize.width
            : activeBreakpointWidthState
        }
        previewHeightPx={
          responsiveInteractActive ? interactDeviceSize.height : undefined
        }
        shaderFillPreview={shaderFillPreview}
        onComponentSourceJump={handleComponentSourceJump}
        motionTracks={motionTracksWire}
        motionDefaultEase={motionDefaultEase}
        motionDurationMs={motionDurationMs}
        gradientEditTarget={inScreenGradientEditTarget}
        onGradientEditChange={handleInScreenGradientEditChange}
        statePreviewTarget={statePreviewTarget}
        editMode={activeScreenSnapshotOnly || mode === "edit"}
        interactMode={!activeScreenSnapshotOnly && mode === "interact"}
        centerInteractPreview={responsiveInteractActive}
        readOnly={!canEditActiveVisualScreen}
        scaleMode={activeTool === "scale"}
        handToolActive={activeTool === "hand"}
        spacePanActive={spacePanActive}
        activeCreationTool={activeSingleScreenCreationTool}
        selectedPenPathNodeId={selectedPenPathNodeId}
        onCreatePrimitive={handleSingleScreenCreatePrimitive}
        onUpdatePenPath={
          canEditDesign
            ? (nodeId, path, nextTool) => {
                const updated = activeFile
                  ? handleUpdatePenPath(activeFile.id, nodeId, path)
                  : false;
                if (updated && nextTool) {
                  setActiveTool(nextTool);
                }
                return updated;
              }
            : undefined
        }
        onDropFiles={canEditDesign ? handleSingleScreenDropFiles : undefined}
        clearSelectionRequest={overviewClearSelectionRequest}
        selectedSelector={selectedCanvasSelector}
        selectedSelectorCandidates={selectedCanvasSelectorCandidates}
        selectedSelectorGroups={
          activeFile
            ? (selectedLayerSelectorGroupsByScreen[activeFile.id] ?? [])
            : []
        }
        hoveredSelector={hoveredCanvasSelector}
        hoveredSelectorCandidates={hoveredCanvasSelectorCandidates}
        lockedSelectors={lockedLayerSelectors}
        hiddenSelectors={hiddenLayerSelectors}
        onElementSelect={handleElementSelect}
        onElementMarqueeSelect={handleElementMarqueeSelect}
        onElementHover={handleElementHover}
        onEditorDragStateChange={handleEditorDragStateChange}
        onClearSelection={() => {
          explicitOverviewScreenSelectionRef.current = [];
          setSelectedElement(null);
          setHoveredElement(null);
          setHoveredElementScreenId(null);
          setSelectedLayerIdsState([]);
          setOverviewClearSelectionRequest((request) => request + 1);
        }}
        onIframeHotkey={handleIframeHotkey}
        onFigmaClipboardPaste={handleCanvasFigmaClipboardPaste}
        onImagePaste={handleCanvasImagePaste}
        onIframeContextMenu={handleIframeContextMenu}
        onVisualStyleChange={handleVisualStyleChange}
        onVisualStyleBatchChange={(changes) =>
          handleKScaleStyleBatchChange(activeFile.id, changes)
        }
        onVisualStructureChange={handleVisualStructureChange}
        onVisualDuplicateChange={handleVisualDuplicateChange}
        onTextContentChange={handleTextContentChange}
        onTextEditingStateChange={(state) =>
          handleTextEditingStateChangeForScreen(activeFile.id, state)
        }
        onElementDblClickText={handleElementDblClickText}
        tweakValues={cssVarValues}
        drawMode={drawMode}
        onExitDrawMode={() => {
          handleExitFocusedDrawMode();
        }}
        drawOverlayResetSignal={focusedAnnotationResetSignal}
        retainDrawOverlayWhenHidden
        onAnnotationSendingChange={handleFocusedAnnotationSendingChange}
        pinMode={pinMode}
        commentPinsHidden={commentsHidden}
        onExitPinMode={handleExitReviewCommentMode}
        designId={id}
        reviewCanPost={canCommentDesign}
        reviewCanResolve={canEditDesign}
        reviewCurrentUserEmail={session?.email}
        reviewFocusRequest={reviewFocusRequest}
        onDispatchCommentToAgent={
          canEditDesign ? handleDispatchCommentToAgent : undefined
        }
        onSendThreadToAgent={
          canEditDesign ? handleSendReviewThreadToAgent : undefined
        }
        reviewSendingThreadId={reviewSendingThreadId}
        designTitle={design?.title}
        commentContextId={`${id}:${activeFile.id}`}
        commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(activeFile.filename)}`}
        repromptDraftRequest={
          repromptDraftRequest?.fileId === activeFile.id
            ? repromptDraftRequest
            : null
        }
        nodeRewriteCanvasTarget
        onRepromptDraftConsumed={handleRepromptDraftConsumed}
        onPrototypeNavigate={(screen) => {
          if (!screen) return;
          const norm = (s: string) =>
            s
              .replace(/^\.?\//, "")
              .replace(/\.html?$/i, "")
              .toLowerCase();
          const target = norm(screen);
          if (!target) return;
          const match = files.find((f) => norm(f.filename) === target);
          if (match) {
            handleModeChange("interact", {
              targetFileId: match.id,
            });
          }
        }}
      />
      {/* §6.4 — the breakpoint bar itself now renders as a
                          non-overlapping chrome row ABOVE canvasContainerRef
                          (see the shared block right before that div's
                          opening tag), not here. */}
      {/* Presence: remote selection rings (human peers + AI),
                          resolved into the active screen's iframe. */}
      {others.length > 0 && (
        <RemoteSelectionRings
          others={othersForOverlays}
          resolveRect={resolveSelectionRect}
          containerRef={canvasContainerRef}
        />
      )}
      {/* Presence: lingering fading highlights over regions a
                          peer or the AI just edited. */}
      {recentEditsForOverlays.length > 0 && (
        <RecentEditHighlights
          edits={recentEditsForOverlays}
          resolveRect={resolveRecentEditRect}
          containerRef={canvasContainerRef}
        />
      )}
      {/* Presence: live cursor overlay for remote participants.
                          The AI gets a synthesized cursor derived from its
                          current edit target (see othersWithAgentCursor). */}
      {visibleCursorOthers.length > 0 && (
        <LiveCursorOverlay
          others={visibleCursorOthers}
          containerRef={canvasContainerRef}
        />
      )}
    </>
  );
}

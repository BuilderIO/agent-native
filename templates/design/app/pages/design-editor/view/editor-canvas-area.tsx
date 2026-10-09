import type { ReactElement } from "react";

import { CanvasContextMenu } from "@/components/design/CanvasContextMenu";
import { FusionAppBanner } from "@/components/design/FusionAppBanner";
import { GenerationStatusCard } from "@/components/design/GenerationStatusCard";
import { ReadOnlyDesignBanner } from "@/components/design/ReadOnlyDesignBanner";
import {
  ContextMenuGroup,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { DrawOverlay as SharedDrawOverlay } from "@/components/visual-editor/DrawOverlay";
import { readSystemClipboard } from "@/lib/design-clipboard";
import { hasExplicitOverviewZoomCommand as hasExplicitOverviewZoomCommandFromSearchParams } from "@/lib/design-editor-route";

import { bridgeSourceIdForCodeLayerNode } from "../code-layer-state";
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
import { rightInspectorCanvasInset } from "../minimal-inspector";
import { resolveOverviewScreenSourceType } from "../pending-edits";
import { isScreenRootElementInfo } from "../selection-state";
import { getSingleScreenCreationTool } from "../tool-state";
import type { DesignData } from "../types";
import { renderOverviewCanvas } from "./overview-canvas";
import { renderSingleScreenCanvas } from "./single-screen-canvas";
import { renderVisualEditApplyToolbar } from "./visual-edit-apply-toolbar";

export function renderEditorCanvasArea({
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
  canApplyPendingVisualEditsWithAgent,
  renderResponsiveInteractBar,
  leftChromeOverlayInset,
  rightSidebarVisible,
  chromeInsetLeft,
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
  canApplyPendingVisualEditsWithAgent: boolean;
  renderResponsiveInteractBar: (floating: boolean) => ReactElement;
  leftChromeOverlayInset: string | undefined;
  rightSidebarVisible: boolean;
  chromeInsetLeft: number;
}) {
  const {
    activeFileId,
    viewMode,
    initialSearchParams,
    activeTool,
    hoveredElement,
    runtimeStructureInsertRequest,
    widgetEmbed,
    selectedElement,
    t,
    isVisualEditSurface,
    hostOwnsChrome,
    pendingVisualEditPublicationFailed,
    overviewInteractScreenId,
    mode,
  } = editorCore;
  const {
    selectedLayerIdsState,
    rightSidebarWidth,
    menuClipboardReadIdRef,
    setHasSystemClipboardImages,
    hasSystemClipboardImages,
    minimalUi,
  } = editorHistory;
  const {
    canEditDesign,
    generating,
    pendingGenerationActive,
    generationIssue,
    retryablePrompt,
    handleRetryGeneration,
    designAccessRole,
    pinMode,
    canCommentDesign,
    drawMode,
  } = editorGenerationAndAccess;
  const {
    layoutGrids,
    localhostPreviewTokenQuery,
    liveScreenSnapshotsById,
    files,
    overviewScreens,
    designSourceType,
  } = editorFilesAndSaving;
  const {
    activeScreenSnapshotOnly,
    activeOverviewScreen,
    effectiveLiveEditRegistrationCapabilitiesByScreenId,
    publicVisualEditConnectionId,
    activeFile,
    activeCanvasSourceType,
    setZoom,
    handleZoomIn,
    handleZoomOut,
  } = editorActiveScreenAndGeometry;
  const {
    hoveredElementScreenId,
    handleZoomToFit,
    handleCanvasBackgroundClick,
  } = editorCanvasAndScreens;
  const {
    selectedCodeLayerNode,
    selectedElementHasMotionTrack,
    getContextCanvasPoint,
    canvasContainerRef,
    handleCanvasPointerMove,
    inspectorPopoverOpen,
    fullAppBuildingEnabled,
    fusionApp,
  } = editorLiveEditsAndPresence;
  const {
    selectedElementAlreadyComponent,
    selectedElementInsideComponent,
    selectedInstanceActionNodeId,
    uiHidden,
    handleCreateComponentHotkey,
    handleGoToMainComponentMenuAction,
    handleSwapInstanceMenuAction,
    handleDetachInstanceMenuAction,
  } = editorContentAndComponents;
  const {
    selectedScreenIds,
    overviewAnnotationResetSignal,
    handleExitOverviewDrawMode,
    handleSendOverviewAnnotations,
    overviewAnnotationSending,
  } = editorToolsAndVectors;
  const {
    canvasContextMenuRef,
    canvasLayerHitCandidates,
    handleContextMenuSelectLayer,
    setCanvasLayerHitCandidates,
    canEditActiveVisualScreen,
    handleRotateSelectionClockwise,
    handleFrameSelection,
  } = editorSelectionAndStyles;
  const {
    hasCanvasClipboard,
    menuClipboardFilesRef,
    lastWrittenClipboardMarkerRef,
    adoptDesignClipboardPayload,
    getCanvasClipboardEntries,
    handleContextMenuPaste,
    handleZoomToSelectionFit,
    handleCopySelection,
    handlePasteOverSelection,
    handleDuplicateSelection,
    handleDeleteSelection,
    handleGroupSelection,
    handleUngroupSelection,
    handlePasteToReplace,
  } = editorClipboard;
  const {
    runtimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
    canSuggestAutoLayout,
    commentsHidden,
    handleContextMenuReprompt,
    handleContextMenuRepromptLayer,
    handleAddAutoLayout,
    handleSuggestAutoLayout,
    handleToggleUi,
    handleToggleComments,
  } = editorLayoutAndStructure;
  const {
    runtimeStructureMoveRequest,
    hasPropsClipboard,
    hasAnimationClipboard,
    changeSelectedZIndex,
    handleCopyProps,
    handlePasteProps,
    handleCopyAnimation,
    handlePasteAnimation,
    handleFlipHorizontal,
    handleFlipVertical,
  } = editorEditCommands;
  const { responsiveInteractActive, handlePinToolToggle } = editorModes;
  const {
    handleSelectAllFrames,
    layersPanelRef,
    handleCopyAsPng,
    handleCopyAsFigmaSvg,
  } = editorExportAndHandoff;
  const {
    codeLayerOwnerByNodeId,
    canEditSelectedLiveLayer,
    canEditSingleSelectedLiveLayer,
    getSingleSelectedRenamableLayerId,
    selectedLayerIds,
    designIsEmpty,
  } = editorLayerModels;
  const { canvasBackground } = editorScreenInspector;
  const {
    selectedActiveFileNodeIds,
    selectedDomLayerIds,
    selectedLayersUseCompatibleSourceBackend,
    activeLayerLocked,
    activeLayerHidden,
    activeLayerId,
    canUngroup,
    handleToggleLayerLocked,
    handleToggleLayerHidden,
  } = editorLayerActions;
  const { handleBooleanSubtractSelection } = editorSourceAndSync;

  const activeScreenLayoutGridStep =
    activeFileId && layoutGrids[activeFileId]
      ? layoutGrids[activeFileId].size
      : 1;
  const activeScreenLiveEditRegistrationCapability = activeScreenSnapshotOnly
    ? undefined
    : ((activeOverviewScreen?.id
        ? effectiveLiveEditRegistrationCapabilitiesByScreenId[
            activeOverviewScreen.id
          ]
        : undefined) ??
      (activeOverviewScreen?.connectionId
        ? localhostPreviewTokenQuery.data?.connections?.[
            activeOverviewScreen.connectionId
          ]?.liveEditRegistrationCapability
        : undefined) ??
      (activeOverviewScreen?.connectionId === publicVisualEditConnectionId
        ? localhostPreviewTokenQuery.data?.liveEditRegistrationCapability
        : undefined));
  const activeScreenExternalSnapshotHtml = activeFile?.id
    ? liveScreenSnapshotsById[activeFile.id]?.html
    : undefined;
  const hasExplicitOverviewZoomCommand =
    viewMode === "overview" &&
    hasExplicitOverviewZoomCommandFromSearchParams(initialSearchParams);
  const activeSingleScreenCreationTool = getSingleScreenCreationTool({
    activeTool,
    viewMode,
    hasActiveFile: Boolean(activeFile),
  });
  const hoveredElementIsScreenRoot = isScreenRootElementInfo(hoveredElement);
  const hoveredScreenRootId = hoveredElementIsScreenRoot
    ? hoveredElementScreenId
    : null;
  const hoveredChildScreenId = hoveredElementIsScreenRoot
    ? null
    : hoveredElementScreenId;
  const canOfferBooleanSubtract =
    canEditDesign &&
    Boolean(activeFile) &&
    selectedLayerIdsState.length === selectedActiveFileNodeIds.length &&
    selectedActiveFileNodeIds.length >= 2;
  const canGroup =
    canEditDesign &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 1 &&
    selectedLayersUseCompatibleSourceBackend;

  const overviewScreenContentRenderKey = [
    runtimeStructureMoveRequest?.requestId ?? "",
    runtimeStructureInsertRequest?.requestId ?? "",
    runtimeStructureInsertRequest?.transactionId ?? "",
    runtimeStructureDeleteRequest?.requestId ?? "",
    runtimeStructureRollbackRequest?.requestId ?? "",
  ].join("|");
  const chromeInsetRight = rightInspectorCanvasInset({
    visible: rightSidebarVisible,
    width: rightSidebarWidth,
    widgetEmbed,
  });

  const selectedLayerId =
    selectedLayerIdsState.length === 1
      ? (selectedLayerIdsState[0] ?? null)
      : null;
  const selectedLayerNode = selectedLayerId
    ? codeLayerOwnerByNodeId.get(selectedLayerId)?.node
    : undefined;
  const selectedPenPathNodeId =
    (selectedCodeLayerNode
      ? bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode)
      : selectedElement?.sourceId) ??
    (selectedLayerNode
      ? bridgeSourceIdForCodeLayerNode(selectedLayerNode)
      : selectedLayerId);

  return (
    <CanvasContextMenu
      ref={canvasContextMenuRef}
      selectedCount={selectedElement ? 1 : selectedScreenIds.length}
      layerCandidates={canvasLayerHitCandidates}
      onSelectLayer={handleContextMenuSelectLayer}
      hasClipboard={hasCanvasClipboard}
      hasPropsClipboard={hasPropsClipboard}
      hasAnimationClipboard={hasAnimationClipboard}
      isLocked={activeLayerLocked}
      isHidden={activeLayerHidden}
      labels={{
        selectLayer: t("designEditor.componentInstances.selectLayer"),
        goToMainComponent: t("designEditor.componentInstances.goToMain"),
        swapInstance: t("designEditor.componentInstances.swap"),
        detachInstance: t("designEditor.componentInstances.detach"),
        suggestAutoLayout: t("designEditor.autoLayoutSuggestion.menuLabel"),
        reprompt: t("designEditor.nodeRewrite.regenerate"),
      }}
      // U4/U8: hasCanvasClipboard only reflects copies made in THIS
      // tab/window. Peek the live system clipboard right as the menu
      // opens so a copy made elsewhere is picked up before the
      // Paste/Paste-here items render — otherwise they stay disabled
      // until the user's first same-tab copy even though a real
      // clipboard payload is already sitting in the OS clipboard.
      onOpenChange={(open) => {
        if (!open) {
          setCanvasLayerHitCandidates([]);
          menuClipboardReadIdRef.current += 1;
          menuClipboardFilesRef.current = [];
          setHasSystemClipboardImages(false);
        }
        if (open) {
          const readId = ++menuClipboardReadIdRef.current;
          menuClipboardFilesRef.current = [];
          setHasSystemClipboardImages(false);
          void readSystemClipboard().then((contents) => {
            if (readId !== menuClipboardReadIdRef.current) return;
            if (
              contents?.design &&
              contents.design.markerText !==
                lastWrittenClipboardMarkerRef.current
            ) {
              adoptDesignClipboardPayload(
                contents.design.payload,
                contents.design.markerText,
                contents.design.plainText,
              );
            }
            menuClipboardFilesRef.current = contents?.files ?? [];
            setHasSystemClipboardImages(Boolean(contents?.files.length));
          });
        }
      }}
      canPasteHere={
        canEditDesign &&
        (hasCanvasClipboard || hasSystemClipboardImages) &&
        Boolean(activeFile)
      }
      canSelectAll={files.length > 0}
      canZoomToFit={Boolean(activeFile)}
      canZoomToSelection={Boolean(
        selectedElement || selectedScreenIds.length > 0,
      )}
      canCopy={Boolean(
        selectedElement?.selector || selectedScreenIds.length > 0,
      )}
      canPaste={
        canEditDesign &&
        (hasCanvasClipboard || hasSystemClipboardImages) &&
        Boolean(activeFile)
      }
      canPasteOver={canEditDesign && hasCanvasClipboard && Boolean(activeFile)}
      canDuplicate={Boolean(
        canEditActiveVisualScreen &&
        (selectedElement || selectedScreenIds.length > 0),
      )}
      canDelete={Boolean(
        (canEditDesign && (selectedElement || selectedScreenIds.length > 0)) ||
        (!canEditDesign && canEditSelectedLiveLayer),
      )}
      canReorder={
        (canEditDesign || canEditSingleSelectedLiveLayer) &&
        Boolean(selectedElement)
      }
      canRename={
        (canEditDesign || canEditSingleSelectedLiveLayer) &&
        Boolean(getSingleSelectedRenamableLayerId())
      }
      canToggleLocked={
        (canEditDesign || canEditSelectedLiveLayer) && Boolean(activeLayerId)
      }
      canToggleHidden={canEditActiveVisualScreen && Boolean(activeLayerId)}
      canCopyProps={Boolean(selectedElement)}
      canPasteProps={
        canEditActiveVisualScreen &&
        hasPropsClipboard &&
        Boolean(selectedElement)
      }
      canCopyAnimation={
        Boolean(selectedElement) && selectedElementHasMotionTrack
      }
      canPasteAnimation={
        canEditDesign && hasAnimationClipboard && Boolean(selectedElement)
      }
      canCopyAsCode={Boolean(
        selectedElement?.selector || selectedScreenIds.length > 0,
      )}
      canCopyAsPng={Boolean(
        canEditDesign &&
        (selectedElement ||
          (viewMode === "overview" && selectedScreenIds.length === 1)),
      )}
      canCopyAsSvg={Boolean(
        canEditDesign &&
        (selectedElement ||
          (viewMode === "overview" && selectedScreenIds.length === 1)),
      )}
      canRotateClockwise={canEditDesign && Boolean(selectedElement)}
      canGroup={canGroup}
      canUngroup={canUngroup}
      canPasteToReplace={
        canEditDesign &&
        (menuClipboardFilesRef.current.length === 1 ||
          getCanvasClipboardEntries().length === 1) &&
        Boolean(selectedElement)
      }
      canFrameSelection={
        canEditDesign &&
        viewMode === "single" &&
        selectedLayerIds.filter(
          (layerId) =>
            !layerId.startsWith("__") &&
            !files.some((file) => file.id === layerId),
        ).length >= 1
      }
      canCreateComponent={
        canEditDesign &&
        Boolean(selectedElement) &&
        !selectedElementAlreadyComponent &&
        !selectedElementInsideComponent
      }
      canReprompt={
        canEditDesign &&
        ((Boolean(selectedElement) && activeCanvasSourceType === "inline") ||
          canvasLayerHitCandidates.some((candidate) => {
            const screen = overviewScreens.find(
              (item) =>
                item.id ===
                (candidate.screenId ?? activeFile?.id ?? activeFileId),
            );
            return (
              Boolean(screen) &&
              resolveOverviewScreenSourceType(screen!, designSourceType) ===
                "inline"
            );
          }))
      }
      isComponentInstance={
        canEditDesign && Boolean(selectedInstanceActionNodeId)
      }
      canFlipHorizontal={canEditDesign && Boolean(selectedElement)}
      canFlipVertical={canEditDesign && Boolean(selectedElement)}
      canAddAutoLayout={
        canEditDesign &&
        viewMode === "single" &&
        selectedLayerIds.filter(
          (layerId) =>
            !layerId.startsWith("__") &&
            !files.some((file) => file.id === layerId),
        ).length >= 1
      }
      canSuggestAutoLayout={canSuggestAutoLayout}
      isUiHidden={uiHidden}
      isCommentsHidden={commentsHidden}
      getCanvasPoint={getContextCanvasPoint}
      onPasteHere={(details) =>
        void handleContextMenuPaste(details.point ?? undefined)
      }
      onSelectAll={handleSelectAllFrames}
      onZoomToFit={handleZoomToFit}
      onZoomToSelection={() => {
        if (viewMode === "overview") {
          handleZoomToSelectionFit();
          return;
        }
        if (selectedElement) setZoom(150);
      }}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      onCopy={handleCopySelection}
      onPaste={() => void handleContextMenuPaste()}
      onPasteOver={handlePasteOverSelection}
      onDuplicate={handleDuplicateSelection}
      onDelete={handleDeleteSelection}
      onBringForward={() => changeSelectedZIndex("forward")}
      onBringToFront={() => changeSelectedZIndex("front")}
      onSendBackward={() => changeSelectedZIndex("backward")}
      onSendToBack={() => changeSelectedZIndex("back")}
      onRename={() => {
        const layerId = getSingleSelectedRenamableLayerId();
        if (layerId) layersPanelRef.current?.beginRename(layerId);
      }}
      onToggleLocked={() => {
        if (activeLayerId) {
          handleToggleLayerLocked(activeLayerId, !activeLayerLocked);
        }
      }}
      onToggleHidden={() => {
        if (activeLayerId) {
          handleToggleLayerHidden(activeLayerId, !activeLayerHidden);
        }
      }}
      onGroup={canGroup ? handleGroupSelection : undefined}
      onUngroup={canUngroup ? handleUngroupSelection : undefined}
      onCopyProps={handleCopyProps}
      onPasteProps={handlePasteProps}
      onCopyAnimation={handleCopyAnimation}
      onPasteAnimation={handlePasteAnimation}
      onCopyAsCode={handleCopySelection}
      onCopyAsPng={() => void handleCopyAsPng()}
      onCopyAsSvg={() => void handleCopyAsFigmaSvg()}
      onRotateClockwise={handleRotateSelectionClockwise}
      onPasteToReplace={
        canEditDesign
          ? () => void handlePasteToReplace(menuClipboardFilesRef.current)
          : undefined
      }
      onFrameSelection={canEditDesign ? handleFrameSelection : undefined}
      onCreateComponent={
        canEditDesign ? handleCreateComponentHotkey : undefined
      }
      onReprompt={handleContextMenuReprompt}
      onRepromptLayer={handleContextMenuRepromptLayer}
      onGoToMainComponent={
        canEditDesign ? handleGoToMainComponentMenuAction : undefined
      }
      onSwapInstance={canEditDesign ? handleSwapInstanceMenuAction : undefined}
      onDetachInstance={
        canEditDesign ? handleDetachInstanceMenuAction : undefined
      }
      onFlipHorizontal={canEditDesign ? handleFlipHorizontal : undefined}
      onFlipVertical={canEditDesign ? handleFlipVertical : undefined}
      onAddAutoLayout={canEditDesign ? handleAddAutoLayout : undefined}
      onSuggestAutoLayout={
        canSuggestAutoLayout ? handleSuggestAutoLayout : undefined
      }
      onToggleUi={handleToggleUi}
      onToggleComments={handleToggleComments}
      appendedItems={
        canOfferBooleanSubtract ? (
          <ContextMenuGroup>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                {t("layersPanel.booleanOperations")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={handleBooleanSubtractSelection}>
                  {t("layersPanel.subtract")}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
        ) : undefined
      }
    >
      {designIsEmpty &&
      (generating || pendingGenerationActive || generationIssue) ? (
        <GenerationStatusCard
          generating={generating || pendingGenerationActive}
          issue={generationIssue}
          retryablePrompt={retryablePrompt?.prompt ?? null}
          onRetry={handleRetryGeneration}
        />
      ) : viewMode === "overview" || activeFile ? (
        <div
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
          style={
            responsiveInteractActive && leftChromeOverlayInset
              ? { paddingLeft: leftChromeOverlayInset }
              : undefined
          }
        >
          {/* Interact's device chrome sits inside the canvas column so
                    the workspace rails stay put — Interact is a different view
                    of the same editor, not a chrome-free takeover. */}
          {responsiveInteractActive && !minimalUi ? (
            <div className="shrink-0">{renderResponsiveInteractBar(false)}</div>
          ) : null}
          {/* Breakpoint targeting controls live in the selected Screen
                    inspector section instead of over the canvas. */}
          <div
            ref={canvasContainerRef}
            data-design-canvas-container
            className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-canvas-bg)]"
            style={
              {
                isolation: "isolate",
                willChange: "opacity",
                ...(canvasBackground
                  ? {
                      "--design-editor-canvas-bg": canvasBackground,
                    }
                  : {}),
              } as React.CSSProperties
            }
            onPointerMove={handleCanvasPointerMove}
            onClick={handleCanvasBackgroundClick}
          >
            {/* Transparent shield that blocks pointer events reaching the
                    iframe when a portaled Radix popover (e.g. color picker) is
                    open. The iframe has its own event context so it receives
                    pointer events even when visually covered by the popover. */}
            {inspectorPopoverOpen && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  pointerEvents: "auto",
                }}
              />
            )}
            {!isVisualEditSurface &&
              (designAccessRole === "viewer" ||
                designAccessRole === "commenter") && (
                <ReadOnlyDesignBanner
                  pinMode={pinMode}
                  onCommentPin={
                    !hostOwnsChrome && canCommentDesign
                      ? handlePinToolToggle
                      : undefined
                  }
                />
              )}
            {/* Full-app building status/controls. Renders only for
                      designs backed by a fusion app (see readFusionApp) and
                      only while the flag is on — the fusion actions the
                      banner calls are gated on the same flag, so rendering it
                      with the flag off would show controls that all error. */}
            {fullAppBuildingEnabled && id && fusionApp && (
              <FusionAppBanner
                designId={id}
                status={fusionApp.status}
                statusMessage={fusionApp.statusMessage}
                previewUrl={fusionApp.previewUrl}
                editorUrl={fusionApp.editorUrl}
                deployedUrl={fusionApp.deployedUrl}
              />
            )}
            {pendingVisualEditPublicationFailed ? (
              <div
                data-design-visual-edit-publication-warning
                role="status"
                className="pointer-events-none absolute inset-x-0 top-16 z-[70] flex justify-center px-4"
              >
                <div className="pointer-events-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {t("designEditor.toasts.codingHandoffError")}
                </div>
              </div>
            ) : null}
            {renderVisualEditApplyToolbar({
              editorCore,
              editorHistory,
              editorFilesAndSaving,
              editorModes,
              editorExportAndHandoff,
              canApplyPendingVisualEditsWithAgent,
            })}
            {viewMode === "overview" ||
            (responsiveInteractActive &&
              overviewInteractScreenId === activeFileId) ? (
              <>
                {/* ── Render: overview canvas ── */}
                {renderOverviewCanvas({
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
                })}
              </>
            ) : (
              <>
                {/* ── Render: single-screen canvas ── */}
                {renderSingleScreenCanvas({
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
                })}
              </>
            )}
            {/* This overview annotation overlay is deliberately outside
                      the overview/single subtree. Entering a focused screen
                      hides it without unmounting it, so board-wide work is
                      still available when the user returns. Its reset signal
                      is separate from DesignCanvas's focused-screen batch. */}
            <SharedDrawOverlay
              visible={
                viewMode === "overview" && drawMode && mode === "annotate"
              }
              clearSignal={overviewAnnotationResetSignal}
              scopeKey="overview"
              retainSurfaceWhenHidden
              zoom={100}
              onClose={handleExitOverviewDrawMode}
              onSend={handleSendOverviewAnnotations}
              sending={overviewAnnotationSending}
            />
          </div>
        </div>
      ) : null}
    </CanvasContextMenu>
  );
}

import { maxPenCornerRadius } from "@shared/pen-path";
import { IconArrowsDown, IconX, IconLayoutSidebar } from "@tabler/icons-react";

import { BreakpointDeviceControl } from "@/components/design/BreakpointBar";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import { DesignBottomToolbar } from "@/components/design/editor/DesignBottomToolbar";
import { KeyboardShortcutsDialog } from "@/components/design/KeyboardShortcutsDialog";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { ResponsiveInteractExitButton } from "@/components/design/ResponsiveInteractBar";
import { DesignAccessState } from "@/components/DesignAccessState";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { ResponsiveEditScope } from "./command-types";
import { pageHasWebMcpHost } from "./design-editor-shared";
import type { EditorActiveScreenAndGeometry } from "./domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./domains/use-editor-canvas-and-screens";
import type { EditorClipboard } from "./domains/use-editor-clipboard";
import type { EditorContentAndComponents } from "./domains/use-editor-content-and-components";
import type { EditorCore } from "./domains/use-editor-core";
import type { EditorEditCommands } from "./domains/use-editor-edit-commands";
import type { EditorExportAndHandoff } from "./domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "./domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./domains/use-editor-generation-and-access";
import type { EditorHistory } from "./domains/use-editor-history";
import type { EditorLayerActions } from "./domains/use-editor-layer-actions";
import type { EditorLayerModels } from "./domains/use-editor-layer-models";
import type { EditorLayoutAndStructure } from "./domains/use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "./domains/use-editor-live-edits-and-presence";
import type { EditorModes } from "./domains/use-editor-modes";
import type { EditorScreenChangeHandlers } from "./domains/use-editor-screen-change-handlers";
import type { EditorScreenInspector } from "./domains/use-editor-screen-inspector";
import type { EditorScreenRendering } from "./domains/use-editor-screen-rendering";
import type { EditorSelectionAndStyles } from "./domains/use-editor-selection-and-styles";
import type { EditorSourceAndSync } from "./domains/use-editor-source-and-sync";
import type { EditorToolsAndVectors } from "./domains/use-editor-tools-and-vectors";
import {
  buildSignInHrefForComment,
  buildSignInHrefForDesignIntent,
} from "./editor-helpers";
import { hasMinimalInspectorSelection } from "./minimal-inspector";
import { getDesignBottomToolbarMode } from "./tool-state";
import { SHOW_DESIGN_SECONDARY_LEFT_PANELS } from "./types";
import { renderEditorCanvasArea } from "./view/editor-canvas-area";
import { renderEditorDialogs } from "./view/editor-dialogs";
import { renderLeftSidebar } from "./view/left-sidebar";
import { renderMobileInspectorSheet } from "./view/mobile-inspector-sheet";
import { renderMotionDockPanel } from "./view/motion-dock-panel";
import { renderNodeRewriteAndLocalhostDialogs } from "./view/node-rewrite-and-localhost-dialogs";
import { renderPendingNodeRewriteControl } from "./view/pending-node-rewrite-control";
import { renderProjectMenu } from "./view/project-menu";
import { renderProjectTitleControl } from "./view/project-title-control";
import { renderPromptPopovers } from "./view/prompt-popovers";
import { renderPublishWaitlistControl } from "./view/publish-waitlist-control";
import { renderResponsiveInteractToolbar } from "./view/responsive-interact-toolbar";
import { renderRightRail } from "./view/right-rail";
import { renderRightSidebarActions } from "./view/right-sidebar-actions";
import { renderSignedOutPersistenceActions } from "./view/signed-out-persistence-actions";
import { renderZoomMenu } from "./view/zoom-menu";
import { VisualEditWebMcp } from "./VisualEditWebMcp";

export function renderDesignEditorView({
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
}) {
  const {
    t,
    id,
    isSignedIn,
    shellMode,
    embedded,
    hostOwnsChrome,
    hostEmbeddedEditor,
    mode,
    activeTool,
    viewMode,
    selectedElement,
    textEditingState,
  } = editorCore;
  const {
    isBuilderDesignEmbed,
    builderPreviewUrl,
    parentOriginRef,
    activeInspectorTab,
    setActiveInspectorTab,
    activeLeftPanel,
    leftSidebarWidth,
    minimalUi,
    isMobileViewport,
    activeBreakpointWidthState,
    handleInteractionStateChange,
  } = editorHistory;
  const {
    drawMode,
    pinMode,
    pendingQuestions,
    pendingQuestionsTitle,
    pendingQuestionsDescription,
    pendingQuestionsSkipLabel,
    pendingQuestionsSubmitLabel,
    pendingQuestionsSubmissionBlocked,
    pendingQuestionsProviderStatus,
    retryPendingQuestionsProviderStatus,
    handleQuestionsSubmit,
    handleQuestionsSkip,
    pendingQuestionsVisible,
    pendingGenerationActive,
    designLoading,
    refetchDesign,
    designAccessStatus,
    designAccessStatusLoading,
    designAccessStatusError,
    refetchDesignAccessStatus,
    requestDesignAccessMutation,
    designAccessRequestSent,
    handleRequestDesignAccess,
    design,
    canEditDesign,
    canCommentDesign,
    canEditPublicLiveScreenUrl,
    tweaksEnabled,
    reviewUnreadCount,
    updateScreenSourceMutation,
    addBreakpointMutation,
    removeBreakpointMutation,
    updateBreakpointMutation,
  } = editorGenerationAndAccess;
  const {
    breakpointFramesHidden,
    setBreakpointFramesHidden,
    handleTweakChange,
    tweakSelections,
    tweaks,
    editorPreferences,
    setEditorPreferences,
    handleRequestTweaks,
    files,
    getComponentExpectedFiles,
    pendingNodeRewriteByFile,
    documentColorFiles,
    designSourceType,
    layoutGrids,
    handleLayoutGridChange,
    boardFileId,
  } = editorFilesAndSaving;
  const {
    responsiveEditScope,
    activeFile,
    designBreakpoints,
    handleBreakpointBarSelect,
    handleResponsiveEditScopeChange,
    activeScreenBaseWidthPx,
    activeCanvasSourceType,
    handleBreakpointBarRemove,
  } = editorActiveScreenAndGeometry;
  const {
    runtimeLayerSnapshotReadiness,
    handleCreateScreenFromPreset,
    activeContent,
  } = editorCanvasAndScreens;
  const {
    zoom,
    initialGenerationChromeLimited,
    activeRuntimeProjectionEligible,
    activeRuntimeSourceLocationUnavailable,
    motionKeyframeState,
    sourceCapabilities,
    selectedComponentNodeId,
    componentDetailsReady,
    selectedComponentHasLocalOverrides,
  } = editorLiveEditsAndPresence;
  const {
    uiHidden,
    componentSwapPickerRequest,
    selectedElementAlreadyComponent,
    selectedElementInsideComponent,
    defaultComponentName,
    handleToggleMotionKeyframe,
    inspectCodeData,
    handleCreateComponent,
    handleComponentPropApplied,
    handleShaderSourceApplied,
    resolvedReviewPanelProps,
    handleToggleMinimalUi,
  } = editorContentAndComponents;
  const {
    shapeTool,
    vectorEditingState,
    reviewCommentsPanelProps,
    handleVectorCornerRadiusChange,
    handleMoveTool,
    handleShapeTool,
    scaleToolControls,
  } = editorToolsAndVectors;
  const {
    canEditActiveVisualScreen,
    applyLinkedComponentEdit,
    handleStyleChange,
    handleStylesChange,
    handleFontUploaded,
  } = editorSelectionAndStyles;
  const { breakpointContext } = editorScreenChangeHandlers;
  const { handleDesignMediaFiles } = editorClipboard;
  const {
    handleApplyLayoutFlow,
    handleDisableAutoLayout,
    handleAlignSelection,
    alignAvailability,
  } = editorLayoutAndStructure;

  const {
    keyboardShortcutsOpen,
    responsiveInteractActive,
    handleModeChange,
    handleExitResponsiveInteract,
    handlePinToolToggle,
    handleCloseKeyboardShortcuts,
  } = editorModes;
  const {
    pngExporting,
    svgExporting,
    visualEditPromptResult,
    handleRenderExportPreview,
    handleInspectorExport,
  } = editorExportAndHandoff;
  const { selectedLayerIds, handleShaderEditCode, selectedInspectorElements } =
    editorLayerModels;
  const {
    selectedScreenGeometry,
    selectedScreenSource,
    handleRemoveSelectedScreen,
    handleScreenSourceChange,
    handleScreenUrlChange,
    handleSelectedScreenStyleChange,
    handleSelectedScreenStylesChange,
    canvasBackground,
    themedCanvasBackground,
    handleCanvasBackgroundChange,
    handleScreenGeometryChange,
    handleScreenHeightModeChange,
    selectedScreenElement,
    selectionColorScopes,
    handleSelectionColorChange,
    handleSelectionColorPickerOpenChange,
    canSelectSelectionColorTarget,
    handleGroupFillStylesChange,
    handleSelectionColorTarget,
    statesPanelProps,
  } = editorScreenInspector;
  const {
    pageStyles,
    pendingInspectorInteractionStateStyles,
    activeLayerHidden,
    handleOpenAddLocalhostScreen,
    handleToggleHiddenForSelection,
  } = editorLayerActions;
  const {
    frameToolDraws,
    setFrameToolDraws,
    handleFrameTool,
    handleTextTool,
    handlePenTool,
    handleHandTool,
    handleScaleTool,
    handleDrawTool,
    pendingVisualStyleNavigationBlocker,
    activeLocalhostConnectionId,
    activeLocalhostConnectionResult,
    componentRuntime,
    requestLocalhostWrite,
    workbenchLocalhostConnections,
  } = editorSourceAndSync;
  const { handleBreakpointBarAdd, handleBreakpointChangeWidth } =
    editorScreenRendering;
  const signInToShareHref = buildSignInHrefForDesignIntent("share");
  const canApplyPendingVisualEditsWithAgent =
    canEditDesign && (isSignedIn || hostEmbeddedEditor || pageHasWebMcpHost());
  const activeNodeRewriteProposal = activeFile
    ? (pendingNodeRewriteByFile.get(activeFile.id) ?? null)
    : null;
  const designBottomToolbarMode = getDesignBottomToolbarMode({
    isSignedIn,
    canEditDesign,
    canCommentDesign,
    hasActiveFile: Boolean(activeFile),
  });
  const activeRuntimeSourceLocationSnapshotFailed =
    activeRuntimeProjectionEligible &&
    runtimeLayerSnapshotReadiness?.screenId === activeFile?.id &&
    runtimeLayerSnapshotReadiness.readiness.status === "error";
  const pendingVisualStyleWarningOpen =
    pendingVisualStyleNavigationBlocker.state === "blocked";

  const selectedScreenLayoutGrid = selectedScreenGeometry
    ? (layoutGrids[selectedScreenGeometry.id] ?? null)
    : null;
  const addLocalhostScreenConnectionId =
    designSourceType === "localhost"
      ? activeLocalhostConnectionId ||
        workbenchLocalhostConnections[0]?.connectionId
      : undefined;

  if (!id) return null;

  if (
    designLoading ||
    (!design &&
      (pendingGenerationActive ||
        shellMode ||
        designAccessStatusLoading ||
        (!designAccessStatus && !designAccessStatusError)))
  ) {
    return (
      <DesignEditorSkeleton
        embedded={embedded}
        pendingGeneration={pendingGenerationActive}
      />
    );
  }

  if (!design) {
    return (
      <DesignAccessState
        accessStatus={designAccessStatus}
        accessStatusError={
          designAccessStatusError ||
          !designAccessStatus ||
          designAccessStatus.hasAccess
        }
        accessRequestPending={requestDesignAccessMutation.isPending}
        accessRequestSent={designAccessRequestSent}
        signInHref={buildSignInHrefForComment()}
        onRequestAccess={() => void handleRequestDesignAccess()}
        onRetryAccessCheck={() => {
          void Promise.all([refetchDesign(), refetchDesignAccessStatus()]);
        }}
      />
    );
  }

  const questionFlowActive = pendingQuestionsVisible;

  const deviceFrameControl = (
    <BreakpointDeviceControl
      breakpoints={designBreakpoints}
      activeWidthPx={activeBreakpointWidthState}
      baseWidthPx={activeScreenBaseWidthPx}
      canEdit={canEditDesign}
      mutationPending={
        addBreakpointMutation.isPending ||
        removeBreakpointMutation.isPending ||
        updateBreakpointMutation.isPending
      }
      showAllFrames={!breakpointFramesHidden}
      onShowAllFramesChange={(value) => setBreakpointFramesHidden(!value)}
      onSelect={handleBreakpointBarSelect}
      onAdd={canEditDesign ? handleBreakpointBarAdd : undefined}
      onRemove={canEditDesign ? handleBreakpointBarRemove : undefined}
      onChangeWidth={canEditDesign ? handleBreakpointChangeWidth : undefined}
    />
  );
  const responsiveEditScopeControl =
    activeBreakpointWidthState === undefined ? null : (
      <Select
        value={responsiveEditScope}
        onValueChange={(value) =>
          handleResponsiveEditScopeChange(value as ResponsiveEditScope)
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger
              className="size-7 shrink-0 justify-center p-0 [&>svg:last-child]:hidden"
              aria-label={t("designEditor.breakpointBar.scope.label")}
              title={
                responsiveEditScope === "only"
                  ? t("designEditor.breakpointBar.scope.only")
                  : t("designEditor.breakpointBar.scope.cascadeSmaller")
              }
            >
              <IconArrowsDown className="size-3.5" aria-hidden="true" />
              <SelectValue className="sr-only" />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {responsiveEditScope === "only"
              ? t("designEditor.breakpointBar.scope.only")
              : t("designEditor.breakpointBar.scope.cascadeSmaller")}
          </TooltipContent>
        </Tooltip>
        <SelectContent>
          <SelectItem value="cascade-smaller">
            {t("designEditor.breakpointBar.scope.cascadeSmaller")}
          </SelectItem>
          <SelectItem value="only">
            {t("designEditor.breakpointBar.scope.only")}
          </SelectItem>
        </SelectContent>
      </Select>
    );

  const screenBreakpointControls = (
    <div className="design-sidebar-property-group">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {deviceFrameControl}
        </div>
        {responsiveEditScopeControl}
      </div>
    </div>
  );

  const projectMenu = renderProjectMenu({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorLiveEditsAndPresence,
    editorClipboard,
    editorLayoutAndStructure,
    editorEditCommands,
    editorModes,
    editorExportAndHandoff,
    id,
  });

  const projectTitleControl = renderProjectTitleControl({
    editorCore,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    design,
  });

  const minimalUiToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md"
          aria-label={
            minimalUi
              ? "Exit minimal UI" /* i18n-ignore minimal UI chrome */
              : "Minimize UI" /* i18n-ignore minimal UI chrome */
          }
          aria-pressed={minimalUi}
          data-design-minimal-toggle="ui"
          onClick={handleToggleMinimalUi}
        >
          <IconLayoutSidebar className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {
          minimalUi
            ? "Exit minimal UI" /* i18n-ignore minimal UI chrome */
            : "Minimize UI" /* i18n-ignore minimal UI chrome */
        }
      </TooltipContent>
    </Tooltip>
  );

  const renderZoomControl = (controlId: "toolbar" | "inspector") =>
    renderZoomMenu({
      editorCore,
      editorActiveScreenAndGeometry,
      editorCanvasAndScreens,
      editorModes,
      editorScreenRendering,
      controlId,
    });

  const signedOutPersistenceActions = renderSignedOutPersistenceActions({
    editorCore,
    editorFilesAndSaving,
    signInToShareHref,
  });
  const pendingNodeRewriteControl = renderPendingNodeRewriteControl({
    editorCore,
    editorHistory,
    editorFilesAndSaving,
    editorModes,
  });

  const publishWaitlistControl = renderPublishWaitlistControl({
    editorCore,
    editorGenerationAndAccess,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorScreenInspector,
    editorLayerActions,
  });

  const rightSidebarActions = renderRightSidebarActions({
    editorCore,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorExportAndHandoff,
    editorLayerModels,
    editorScreenInspector,
    editorLayerActions,
    editorScreenRendering,
    id,
    design,
    signInToShareHref,
    renderZoomControl,
    signedOutPersistenceActions,
    pendingNodeRewriteControl,
    publishWaitlistControl,
  });

  const renderResponsiveInteractBar = (floating: boolean) =>
    renderResponsiveInteractToolbar({
      editorGenerationAndAccess,
      editorActiveScreenAndGeometry,
      editorModes,
      floating,
    });

  const leftContentWidth =
    activeLeftPanel === "code"
      ? Math.max(leftSidebarWidth, 640)
      : Math.max(
          Math.min(leftSidebarWidth, 420),
          activeLeftPanel === "agent" ? 320 : 220,
        );
  const leftSidebarVisible = !hostOwnsChrome && !uiHidden && !minimalUi;
  const leftChromeOverlayInset = leftSidebarVisible
    ? `calc(var(--design-chrome-rail-width) + ${activeLeftPanel ? leftContentWidth : 0}px)`
    : undefined;
  const minimalInspectorHasSelection = hasMinimalInspectorSelection({
    selectedElement,
    selectedLayerIds,
    selectedScreenGeometry,
  });
  // Below md the inspector panel is display:none and the Sheet below carries
  // it, so the panel must neither inset the canvas nor displace the toolbar.
  const rightSidebarVisible =
    !hostOwnsChrome &&
    !isMobileViewport &&
    !uiHidden &&
    !initialGenerationChromeLimited &&
    !responsiveInteractActive &&
    (!minimalUi || minimalInspectorHasSelection);
  const editPanelProps = {
    selectedElement,
    textEditingState,
    selectionHidden: activeLayerHidden,
    onToggleSelectionHidden: canEditActiveVisualScreen
      ? handleToggleHiddenForSelection
      : undefined,
    readOnly: !canEditActiveVisualScreen,
    selectedElements: selectedInspectorElements,
    selectedScreenGeometry,
    selectedScreenLayoutGrid,
    onLayoutGridChange: canEditDesign ? handleLayoutGridChange : undefined,
    canvasBackground,
    canvasBackgroundFallback: themedCanvasBackground,
    onCanvasBackgroundChange: canEditDesign
      ? handleCanvasBackgroundChange
      : undefined,
    onScreenGeometryChange: canEditDesign
      ? handleScreenGeometryChange
      : undefined,
    onScreenHeightModeChange: canEditDesign
      ? handleScreenHeightModeChange
      : undefined,
    selectedScreenSource,
    sourceLocationUnavailable: activeRuntimeSourceLocationUnavailable,
    sourceLocationSnapshotFailed: activeRuntimeSourceLocationSnapshotFailed,
    localhostConnections: activeLocalhostConnectionResult?.connections,
    onScreenSourceChange: canEditDesign ? handleScreenSourceChange : undefined,
    onScreenUrlChange: canEditPublicLiveScreenUrl
      ? handleScreenUrlChange
      : undefined,
    onAddLocalhostScreen: canEditDesign
      ? handleOpenAddLocalhostScreen
      : undefined,
    onRemoveScreen:
      canEditDesign && files.length > 1
        ? handleRemoveSelectedScreen
        : undefined,
    screenSourcePending: updateScreenSourceMutation.isPending,
    screenBreakpointControls,
    pageStyles,
    selectedScreenElement,
    onSelectedScreenStyleChange: canEditActiveVisualScreen
      ? handleSelectedScreenStyleChange
      : undefined,
    onSelectedScreenStylesChange: canEditActiveVisualScreen
      ? handleSelectedScreenStylesChange
      : undefined,
    vectorPointSelected:
      vectorEditingState?.selectedAnchorIndex !== null &&
      vectorEditingState?.selectedAnchorIndex !== undefined,
    vectorPointRadius: (() => {
      if (!vectorEditingState) return null;
      const selectedIndex = vectorEditingState.selectedAnchorIndex;
      if (selectedIndex === null || vectorEditingState.primitiveSource) {
        return null;
      }
      const max = maxPenCornerRadius(vectorEditingState.path, selectedIndex);
      if (max === null) return null;
      return {
        value: vectorEditingState.path.nodes[selectedIndex]?.cornerRadius ?? 0,
        max,
      };
    })(),
    onVectorPointRadiusChange: canEditDesign
      ? (value: number, meta?: { phase?: "preview" | "commit" | "cancel" }) =>
          handleVectorCornerRadiusChange(
            value,
            meta?.phase === "preview" ? "preview" : "commit",
          )
      : undefined,
    selectionColorScopes,
    onSelectionColorTarget: handleSelectionColorTarget,
    canSelectSelectionColorTarget,
    onSelectionColorChange: canEditActiveVisualScreen
      ? handleSelectionColorChange
      : undefined,
    onSelectionColorPickerOpenChange: canEditActiveVisualScreen
      ? handleSelectionColorPickerOpenChange
      : undefined,
    onGroupFillStylesChange: canEditActiveVisualScreen
      ? handleGroupFillStylesChange
      : undefined,
    viewMode,
    mode,
    files: documentColorFiles,
    activeTool,
    scaleToolControls: canEditDesign ? scaleToolControls : undefined,
    onCreateScreenFromPreset: canEditDesign
      ? handleCreateScreenFromPreset
      : undefined,
    zoom,
    inspectorGridDebug: import.meta.env.DEV
      ? editorPreferences.inspectorGridDebug
      : false,
    onInspectorGridDebugChange: import.meta.env.DEV
      ? (inspectorGridDebug: boolean) =>
          setEditorPreferences({
            ...editorPreferences,
            inspectorGridDebug,
          })
      : undefined,
    activeTab: activeInspectorTab,
    onActiveTabChange: setActiveInspectorTab,
    tweaksEnabled,
    tweaks,
    tweakValues: tweakSelections,
    activeContent,
    pendingInteractionStateStyles: pendingInspectorInteractionStateStyles,
    activeFileUpdatedAt: activeFile?.updatedAt ?? null,
    getComponentExpectedFiles,
    componentDetailsReady,
    componentSwapPickerRequest,
    onComponentPropApplied: handleComponentPropApplied,
    onShaderSourceApplied: handleShaderSourceApplied,
    onFontUploaded:
      canEditActiveVisualScreen && activeCanvasSourceType === "inline"
        ? handleFontUploaded
        : undefined,
    onTweakChange: handleTweakChange,
    onRequestTweaks: handleRequestTweaks,
    onStyleChange: handleStyleChange,
    onStylesChange: handleStylesChange,
    motionKeyframeState: SHOW_DESIGN_SECONDARY_LEFT_PANELS
      ? motionKeyframeState
      : undefined,
    onToggleMotionKeyframe:
      SHOW_DESIGN_SECONDARY_LEFT_PANELS && canEditDesign
        ? handleToggleMotionKeyframe
        : undefined,
    breakpointContext,
    onExport: handleInspectorExport,
    onRenderExportPreview: handleRenderExportPreview,
    exporting: pngExporting || svgExporting,
    designId: id,
    fileId: activeFile?.id,
    boardFileId,
    componentNodeId: selectedComponentNodeId,
    componentRuntime,
    requestLocalhostWrite,
    componentInstanceHasLocalOverrides: selectedComponentHasLocalOverrides,
    onResetComponentInstanceOverrides:
      id && activeFile?.id && selectedComponentHasLocalOverrides
        ? (nodeId: string) =>
            applyLinkedComponentEdit(activeFile.id, nodeId, {
              kind: "resetOverrides",
            })
        : undefined,
    onRestoreComponent:
      canEditDesign && id && activeFile?.id
        ? (nodeId: string) =>
            applyLinkedComponentEdit(activeFile.id, nodeId, {
              kind: "restoreMain",
            })
        : undefined,
    sourceCapabilities,
    selectedElementAlreadyComponent,
    onCreateComponent:
      id &&
      selectedElement &&
      !selectedElementAlreadyComponent &&
      !selectedElementInsideComponent
        ? handleCreateComponent
        : undefined,
    defaultComponentName,
    inspectCode: inspectCodeData,
    statesPanelProps,
    reviewPanelProps: resolvedReviewPanelProps,
    reviewCommentsPanelProps,
    reviewCommentsCount: reviewUnreadCount,
    onAlignSelection: canEditDesign ? handleAlignSelection : undefined,
    alignSelectionDisabled: !alignAvailability.canAlign,
    onDisableAutoLayout: canEditDesign ? handleDisableAutoLayout : undefined,
    onApplyLayoutFlow: canEditDesign ? handleApplyLayoutFlow : undefined,
    onInteractionStateChange: handleInteractionStateChange,
    onEditCode: handleShaderEditCode,
  };

  return (
    <div
      data-design-editor
      className="relative flex h-full flex-col overflow-hidden bg-[var(--design-editor-canvas-bg)]"
    >
      {id ? <VisualEditWebMcp getPrompt={visualEditPromptResult} /> : null}
      {/* ── Render: Builder embed preview ── */}
      {isBuilderDesignEmbed && builderPreviewUrl && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--design-editor-canvas-bg)]">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
            <span className="flex-1 truncate text-sm font-medium text-foreground">
              {t("designEditor.designPreview")}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              onClick={() => {
                window.parent.postMessage(
                  { type: "design:close" },
                  parentOriginRef.current ?? window.location.origin,
                );
              }}
            >
              <IconX className="size-4" />
            </Button>
          </div>
          <iframe
            className="min-h-0 flex-1 border-0"
            src={builderPreviewUrl}
            title={t("designEditor.designPreview")}
            allow="fullscreen"
          />
        </div>
      )}
      {/* ── Render: main canvas area ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {renderLeftSidebar({
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
          editorEditCommands,
          editorModes,
          editorExportAndHandoff,
          editorLayerModels,
          editorLayerActions,
          editorSourceAndSync,
          id,
          canApplyPendingVisualEditsWithAgent,
          projectMenu,
          projectTitleControl,
          minimalUiToggle,
          leftContentWidth,
          leftSidebarVisible,
        })}

        {/* The docked bar's Close used to live inside a canvas column inset
            by the left rail's width (`leftChromeOverlayInset`). A wide rail
            (the Code panel is 640px) plus a modest window can squeeze that
            column until the bar's own `overflow-hidden` clips Close before
            it clips anything else in the row — the rail sits at z-[70], so a
            squeeze this severe doesn't just crowd Close, it makes it
            unreachable. Anchoring it here instead, to the canvas area's own
            right edge rather than the bar's shrunken one, guarantees a way
            out no matter how little room the rail has left the bar. Height-
            and edge-matched to the bar (h-12, pr-3) so it reads as the same
            row rather than a second floating control. Not needed for the
            floating (minimal-UI) bar: minimal UI hides this rail entirely. */}
        {responsiveInteractActive && !minimalUi ? (
          <div className="pointer-events-none absolute right-0 top-0 z-[80] flex h-12 items-center border-b border-border bg-[var(--design-editor-panel-bg)] pl-1 pr-3">
            <ResponsiveInteractExitButton
              onClose={handleExitResponsiveInteract}
              className="pointer-events-auto"
            />
          </div>
        ) : null}

        {/* Interact owns the running app's surface (same reasoning as the
            Escape hotkey gate): its canvas tools and mode tabs belong to the
            infinite canvas, and ResponsiveInteractBar's Close is the way
            back. */}
        {!hostOwnsChrome &&
          !responsiveInteractActive &&
          designBottomToolbarMode === "editor" &&
          design &&
          !questionFlowActive && (
            <DesignBottomToolbar
              mode={mode}
              pinMode={pinMode}
              drawMode={drawMode}
              activeTool={activeTool}
              shapeTool={shapeTool}
              isOverview={viewMode === "overview"}
              hasActiveFile={Boolean(activeFile)}
              onMove={handleMoveTool}
              onFrame={handleFrameTool}
              frameToolDraws={frameToolDraws}
              onFrameToolDrawsChange={setFrameToolDraws}
              onShape={handleShapeTool}
              onText={handleTextTool}
              onPen={handlePenTool}
              onHand={handleHandTool}
              onDraw={handleDrawTool}
              onScale={handleScaleTool}
              onMediaFiles={handleDesignMediaFiles}
              onCommentPin={handlePinToolToggle}
              onModeChange={handleModeChange}
            />
          )}

        {!hostOwnsChrome ? (
          <KeyboardShortcutsDialog
            open={keyboardShortcutsOpen}
            onClose={handleCloseKeyboardShortcuts}
            nudgeAmounts={editorPreferences.nudge}
            onNudgeAmountsChange={(nudge) =>
              setEditorPreferences({ ...editorPreferences, nudge })
            }
          />
        ) : null}

        {/* ── Render: canvas ── */}
        {questionFlowActive ? (
          <div
            className="relative mx-1 h-full min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--design-editor-panel-bg)]"
            style={{ paddingLeft: leftChromeOverlayInset }}
          >
            <QuestionFlow
              questions={pendingQuestions ?? []}
              onSubmit={handleQuestionsSubmit}
              onSkip={handleQuestionsSkip}
              title={pendingQuestionsTitle}
              description={pendingQuestionsDescription}
              skipLabel={pendingQuestionsSkipLabel}
              submitLabel={pendingQuestionsSubmitLabel}
              isSubmissionBlocked={pendingQuestionsSubmissionBlocked}
              providerStatus={pendingQuestionsProviderStatus}
              onRetryProviderStatus={retryPendingQuestionsProviderStatus}
            />
          </div>
        ) : (
          renderEditorCanvasArea({
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
            leftContentWidth,
            leftSidebarVisible,
            leftChromeOverlayInset,
            rightSidebarVisible,
          })
        )}

        {/* ── Render: right rail ── */}
        {renderRightRail({
          editorCore,
          editorHistory,
          editorContentAndComponents,
          editorModes,
          projectTitleControl,
          minimalUiToggle,
          renderZoomControl,
          rightSidebarActions,
          renderResponsiveInteractBar,
          rightSidebarVisible,
          editPanelProps,
        })}
      </div>

      {/* ── Render: mobile inspector sheet ── */}
      {renderMobileInspectorSheet({
        editorCore,
        editorHistory,
        editorLiveEditsAndPresence,
        editorContentAndComponents,
        minimalInspectorHasSelection,
        editPanelProps,
      })}

      {/* ── Render: dialogs ── */}
      {renderEditorDialogs({
        editorCore,
        editorHistory,
        editorClipboard,
        editorLayoutAndStructure,
        editorSourceAndSync,
        id,
        pendingVisualStyleWarningOpen,
      })}

      {/* ── Render: motion dock ── */}
      {renderMotionDockPanel({
        editorCore,
        editorHistory,
        editorGenerationAndAccess,
        editorActiveScreenAndGeometry,
        editorCanvasAndScreens,
        editorLiveEditsAndPresence,
        editorContentAndComponents,
      })}

      {/* ── Render: prompt popovers ── */}
      {renderPromptPopovers({
        editorCore,
        editorHistory,
        editorGenerationAndAccess,
        editorFilesAndSaving,
        editorActiveScreenAndGeometry,
        editorLiveEditsAndPresence,
        editorToolsAndVectors,
        editorLayoutAndStructure,
        id,
        design,
      })}

      {/* ── Render: node rewrite and localhost dialogs ── */}
      {renderNodeRewriteAndLocalhostDialogs({
        editorFilesAndSaving,
        editorActiveScreenAndGeometry,
        editorLayerActions,
        editorSourceAndSync,
        id,
        activeNodeRewriteProposal,
        addLocalhostScreenConnectionId,
      })}
    </div>
  );
}

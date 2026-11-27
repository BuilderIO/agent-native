import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import type { AgentShareDestination } from "@agent-native/toolkit/sharing";
import { maxPenCornerRadius } from "@shared/pen-path";
import {
  IconArrowsDown,
  IconX,
  IconCode,
  IconArchive,
  IconPhoto,
  IconCheck,
  IconDownload,
  IconLayoutSidebar,
  IconDeviceFloppy,
  IconExternalLink,
  IconLink,
  IconMessageCircle,
} from "@tabler/icons-react";

import { BreakpointDeviceControl } from "@/components/design/BreakpointBar";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import { DesignBottomToolbar } from "@/components/design/editor/DesignBottomToolbar";
import { InteractZoomControl } from "@/components/design/editor/InteractZoomControl";
import { UrlScreenControls } from "@/components/design/editor/UrlScreenControls";
import { FusionAppMenu } from "@/components/design/FusionAppMenu";
import { KeyboardShortcutsDialog } from "@/components/design/KeyboardShortcutsDialog";
import { NudgeAmountDialog } from "@/components/design/NudgeAmountDialog";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { ReviewCommentsPanel } from "@/components/design/ReviewCommentsPanel";
import { ShareLivePreview } from "@/components/design/ShareLivePreview";
import { DesignAccessState } from "@/components/DesignAccessState";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SaveStatusIndicator } from "@/components/visual-editor/SaveStatusIndicator";
import { getDesignHostChannel } from "@/host/design-host-channel";
import {
  DESIGN_IMPORT_FORMATS,
  importFormatsAccept,
} from "@/lib/design-import-file-picker";
import { cn } from "@/lib/utils";

import type { ResponsiveEditScope, ShareExportFormat } from "./command-types";
import { layoutMoveRefusalMessageKey } from "./commands/align-selection";
import { resolveUrlScreen } from "./derive/url-screen";
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
  LOCALHOST_COMPILED_SOURCE_EXTENSIONS,
  LOCALHOST_WRITE_EXTENSIONS,
  NO_LOCALHOST_WRITE_CONTENT_MESSAGE,
} from "./editor-constants";
import {
  buildSignInHrefForComment,
  buildSignInHrefForDesignIntent,
} from "./editor-helpers";
import { resolveLocalhostSourceWriteContent } from "./editor-state";
import { resolveScreenRoute } from "./interact-routes";
import { resolveLeftSidebarWidth } from "./left-sidebar-width";
import { shouldRenderDesignShareControl } from "./mcp-widget-write-capabilities";
import {
  hasMinimalInspectorSelection,
  isRightInspectorVisible,
  rightInspectorCanvasInset,
} from "./minimal-inspector";
import { mergePresenceUsers } from "./presence-users";
import { shouldDisableExportsUntilCanvasFramesExist } from "./selection-state";
import { getDesignBottomToolbarMode } from "./tool-state";
import { type EditorMode } from "./types";
import { renderEditorCanvasArea } from "./view/editor-canvas-area";
import { renderEditorDialogs } from "./view/editor-dialogs";
import { DesignFirstOutputNextStep } from "./view/first-output-next-step";
import { renderLeftSidebar } from "./view/left-sidebar";
import {
  MobileCommentsSheet,
  renderMobileInspectorSheet,
} from "./view/mobile-inspector-sheet";
import { renderNodeRewriteAndLocalhostDialogs } from "./view/node-rewrite-and-localhost-dialogs";
import { renderPendingNodeRewriteButton } from "./view/pending-node-rewrite-button";
import { renderProjectMenu } from "./view/project-menu";
import { renderProjectTitleControl } from "./view/project-title-control";
import { renderPromptPopovers } from "./view/prompt-popovers";
import { renderPublishWaitlistControl } from "./view/publish-waitlist-control";
import { renderInteractFloatingBar } from "./view/responsive-interact-toolbar";
import { renderRightRail } from "./view/right-rail";
import { renderRightSidebarActions } from "./view/right-sidebar-actions";
import { renderSignedOutPersistenceActions } from "./view/signed-out-persistence-actions";
import { renderZoomMenu } from "./view/zoom-menu";
import { VisualEditWebMcp } from "./VisualEditWebMcp";

/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */

function getActiveFileId(file: { id: string } | undefined): string | undefined {
  return file?.id;
}

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
  canvasImagesReady,
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
  canvasImagesReady: boolean;
}) {
  const {
    t,
    id,
    isSignedIn,
    sessionResolved,
    session,
    shellMode,
    embedded,
    isVisualEditSurface,
    widgetEmbed,
    minimalUiLocked,
    hostOwnsChrome,
    hostEmbeddedEditor,
    liveRoutePathsByScreenId,
    mode,
    activeTool,
    viewMode,
    selectedElement,
    textEditingState,
  } = editorCore;
  const {
    isBuilderDesignEmbed,
    builderPreviewUrl,
    leftSidebarWidth,
    rightSidebarWidth,
    minimalUi,
    isMobileViewport,
    commentsPanelOpen,
    setCommentsPanelOpen,
    activeBreakpointWidthState,
    handleInteractionStateChange,
  } = editorHistory;
  const {
    setRuntimeLayerSnapshotRequest,
    pinMode,
    reviewFeedbackApplying,
    reviewUnreadCount,
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
    generating,
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
    canShareDesign,
    canEditDesign,
    canCommentDesign,
    canRenderAuthenticatedShare,
    liveCollaborationSaving,
    liveCollaborationEnabled,
    handleLiveCollaborationChange,
    canEditPublicLiveScreenUrl,
    reviewAgentQueueCount,
    updateScreenSourceMutation,
    exportHtmlMutation,
    exportZipMutation,
    addBreakpointMutation,
    removeBreakpointMutation,
    updateBreakpointMutation,
    handleApplyReviewFeedback,
  } = editorGenerationAndAccess;
  const {
    postAuthIntent,
    breakpointFramesHidden,
    setBreakpointFramesHidden,
    editorPreferences,
    setEditorPreferences,
    getComponentExpectedFiles,
    pendingNodeRewriteByFile,
    documentColorFiles,
    tweaks,
    tweakSelections,
    handleTweakChange,
    designSourceType,
    overviewScreens,
    layoutGrids,
    handleLayoutGridChange,
    boardFileId,
    hasLocalhostScreens,
    editorShareUrl,
    canvasFrameGeometryById,
    unsavedChangeCount,
    retryUnsavedChanges,
    tweakMutationsEnabled,
  } = editorFilesAndSaving;
  const {
    responsiveEditScope,
    activeFile,
    designBreakpoints,
    handleBreakpointBarSelect,
    handleResponsiveEditScopeChange,
    activeScreenBaseWidthPx,
    activeScreenSnapshotOnly,
    activeOverviewScreen,
    activeCanvasSourceType,
    handleBreakpointBarRemove,
  } = editorActiveScreenAndGeometry;
  const {
    currentUser,
    runtimeLayerSnapshotReadiness,
    handleCreateScreenFromPreset,
    activeUsers,
    agentPresent,
    agentActive,
    overviewActiveUsers,
    overviewAgentPresent,
    overviewAgentActive,
    activeContent,
  } = editorCanvasAndScreens;
  const {
    zoom,
    followingEmail,
    handleAvatarClick,
    initialGenerationChromeLimited,
    activeRuntimeProjectionEligible,
    activeRuntimeSourceLocationUnavailable,
    sourceCapabilities,
    selectedComponentNodeId,
    componentDetailsReady,
    selectedComponentHasLocalOverrides,
    fullAppBuildingEnabled,
    fusionApp,
  } = editorLiveEditsAndPresence;
  const {
    uiHidden,
    componentSwapPickerRequest,
    selectedElementAlreadyComponent,
    selectedElementInsideComponent,
    defaultComponentName,
    inspectCodeData,
    handleCreateComponent,
    handleGoToMainComponentMenuAction,
    selectedInstanceActionNodeId,
    handleComponentPropApplied,
    handleShaderSourceApplied,
    handleShaderSourceEdit,
    handleToggleMinimalUi,
  } = editorContentAndComponents;
  const {
    vectorEditingState,
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
    nudgeAmountOpen,
    handleCloseNudgeAmount,
    responsiveInteractActive,
    handleModeChange,
    handlePinToolToggle,
    handleScreenReload,
    interactZoom,
    interactZoomChoice,
    handleInteractZoomChange,
    handleCloseKeyboardShortcuts,
  } = editorModes;
  const {
    pngExporting,
    svgExporting,
    handleCopyCodingHandoff,
    handleSendCodingHandoff,
    visualEditPromptResult,
    handleDownloadHtml,
    handleDownloadZip,
    handleDownloadPng,
    handleDownloadSvg,
    handleRenderExportPreview,
    handleInspectorExport,
  } = editorExportAndHandoff;
  const {
    shareExportFormat,
    setShareExportFormat,
    selectedLayerIds,
    selectedInspectorElements,
  } = editorLayerModels;
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
    readSelectionSubtreeColorStyles,
    handleSelectionColorChange,
    handleSelectionColorPickerOpenChange,
    canSelectSelectionColorTarget,
    handleSelectionColorTarget,
    activeScreenPreviewUrl,
    statesPanelProps,
  } = editorScreenInspector;
  const {
    pageStyles,
    pendingInspectorInteractionStateStyles,
    activeLayerHidden,
    activeScreenIsLocalSource,
    handleOpenAddLocalhostScreen,
    activeLocalhostRelPath,
    activeLocalhostSourceSnapshotHtml,
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
    pendingVisualStyleNavigationBlocker,
    activeLocalhostConnectionId,
    activeLocalhostConnectionResult,
    componentRuntime,
    requestLocalhostWrite,
    localhostScreenConnections,
  } = editorSourceAndSync;
  const {
    applyToSourcePending,
    handleApplyToSource,
    handleBreakpointBarAdd,
    handleBreakpointChangeWidth,
  } = editorScreenRendering;
  const signInToShareHref = buildSignInHrefForDesignIntent("share");
  const canApplyPendingVisualEditsWithAgent =
    editorToolsAndVectors.canChatWithAgent;

  const shouldOpenShare = postAuthIntent === "share" && canShareDesign;
  const activeNodeRewriteProposal = activeFile
    ? (pendingNodeRewriteByFile.get(activeFile.id) ?? null)
    : null;
  const designBottomToolbarMode = getDesignBottomToolbarMode({
    isSignedIn,
    canEditDesign,
    canCommentDesign,
    hasActiveFile: Boolean(activeFile),
    scopedWidget: widgetEmbed,
  });
  const activeRuntimeSourceLocationSnapshotFailed =
    activeRuntimeProjectionEligible &&
    runtimeLayerSnapshotReadiness?.screenId === getActiveFileId(activeFile) &&
    runtimeLayerSnapshotReadiness?.readiness.status === "error";
  const pendingVisualStyleWarningOpen =
    pendingVisualStyleNavigationBlocker.state === "blocked";
  const exportsUnavailable = shouldDisableExportsUntilCanvasFramesExist({
    canvasFrameCount: Object.keys(canvasFrameGeometryById).length,
    generating,
    pendingGenerationActive,
  });

  const shareExportOptions: Array<{
    value: ShareExportFormat;
    title: string;
    extension: string;
    // guard:allow-required-description - every export format option ships its own description
    description: string;
    Icon: typeof IconCode;
    disabled: boolean;
    onDownload: () => void;
  }> = [
    {
      value: "html",
      title: "Standalone HTML" /* i18n-ignore share export format */,
      extension: ".html",
      description:
        // i18n-ignore share export description
        "One self-contained file that works offline.",
      Icon: IconCode,
      disabled:
        !activeFile || exportsUnavailable || exportHtmlMutation.isPending,
      onDownload: handleDownloadHtml,
    },
    {
      value: "png",
      title: "PNG image" /* i18n-ignore share export format */,
      extension: ".png",
      description:
        // i18n-ignore share export description
        "Snapshot of the current screen.",
      Icon: IconPhoto,
      disabled: !activeFile || exportsUnavailable || pngExporting,
      onDownload: () => void handleDownloadPng(),
    },
    {
      value: "svg",
      title: "SVG image" /* i18n-ignore share export format */,
      extension: ".svg",
      description:
        // i18n-ignore share export description
        "Scalable snapshot of the current screen.",
      Icon: IconCode,
      disabled: !activeFile || exportsUnavailable || svgExporting,
      onDownload: () => void handleDownloadSvg(),
    },
    {
      value: "zip",
      title: "Project archive" /* i18n-ignore share export format */,
      extension: ".zip",
      description:
        // i18n-ignore share export description
        "Every file in this design, zipped.",
      Icon: IconArchive,
      disabled:
        !activeFile || exportsUnavailable || exportZipMutation.isPending,
      onDownload: handleDownloadZip,
    },
  ];
  const selectedShareExportOption =
    shareExportOptions.find((option) => option.value === shareExportFormat) ??
    shareExportOptions[0];
  const shareExportTab = (
    <div className="space-y-3">
      <div className="!text-[11px] font-semibold uppercase text-muted-foreground">
        {"Format" /* i18n-ignore share export section label */}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {shareExportOptions.map((option) => {
          const selected = option.value === shareExportFormat;
          const ExportIcon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setShareExportFormat(option.value)}
              className={cn(
                "relative flex items-start gap-2.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-2.5 text-left transition-colors hover:bg-[var(--design-editor-panel-raised-bg)]",
                selected
                  ? "bg-[var(--design-editor-panel-raised-bg)] ring-1 ring-[var(--design-editor-accent-color)]"
                  : "",
              )}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--design-editor-panel-raised-bg)] text-muted-foreground">
                <ExportIcon className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-foreground">
                  {option.title}{" "}
                  <span className="!text-[11px] font-medium text-muted-foreground">
                    {option.extension}
                  </span>
                </span>
                <span className="mt-0.5 block !text-[11px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "absolute right-2.5 top-2.5 inline-flex size-4 items-center justify-center rounded-full border",
                  selected
                    ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] text-[var(--design-editor-accent-contrast-color)]"
                    : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)]",
                )}
              >
                {selected ? <IconCheck className="size-3" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--design-editor-panel-divider-color)] pt-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">
            {selectedShareExportOption.title}
          </div>
          <div className="!text-[11px] text-muted-foreground">
            {selectedShareExportOption.description}
          </div>
        </div>
        <Button
          type="button"
          onClick={selectedShareExportOption.onDownload}
          disabled={selectedShareExportOption.disabled}
          className="h-8 gap-1.5 rounded-md bg-[var(--design-editor-accent-color)] px-3 text-[12px] text-[var(--design-editor-accent-contrast-color)] shadow-none hover:bg-[var(--design-editor-accent-hover-color)] hover:text-[var(--design-editor-accent-contrast-color)] disabled:bg-muted disabled:text-muted-foreground"
        >
          <IconDownload className="size-3.5" />
          {"Download" /* i18n-ignore share export action */}
        </Button>
      </div>
    </div>
  );
  // The coding handoff is Design's agent prompt; until the canvas has frames
  // there is nothing to hand off, and the shared read prompt stands in.
  const designShareSendTo = exportsUnavailable
    ? undefined
    : {
        openInAgent: (destination: AgentShareDestination) =>
          void handleSendCodingHandoff(destination),
        copyAgentPrompt: handleCopyCodingHandoff,
      };
  const designShareTabs = {
    shareLabel: "Share link" /* i18n-ignore share tab label */,
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: t("designEditor.export"),
        content: shareExportTab,
      },
      ...(hasLocalhostScreens &&
      sessionResolved &&
      (!isSignedIn || canEditDesign)
        ? [
            {
              value: "live-collaboration",
              label: t("designEditor.liveCollaboration.title"),
              content: isSignedIn ? (
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {t("designEditor.liveCollaboration.title")}
                    </div>
                    {liveCollaborationSaving ? (
                      <p className="text-xs text-muted-foreground">
                        {t("designEditor.liveCollaboration.saving")}
                      </p>
                    ) : null}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch
                        checked={liveCollaborationEnabled}
                        disabled={liveCollaborationSaving}
                        aria-label={t("designEditor.liveCollaboration.title")}
                        onCheckedChange={(enabled) =>
                          void handleLiveCollaborationChange(enabled)
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("designEditor.liveCollaboration.description")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex justify-end py-1">
                  <Button asChild size="sm">
                    <a href={signInToShareHref}>
                      {t("designEditor.signUpToShareLiveCanvas")}
                    </a>
                  </Button>
                </div>
              ),
            },
          ]
        : []),
    ],
  };

  const selectedScreenLayoutGrid = selectedScreenGeometry
    ? (layoutGrids[selectedScreenGeometry.id] ?? null)
    : null;
  const addLocalhostScreenConnectionId =
    designSourceType === "localhost"
      ? activeLocalhostConnectionId ||
        localhostScreenConnections[0]?.connectionId
      : undefined;

  const activeLocalhostWriteExtension =
    (activeLocalhostRelPath?.match(/\.[^.]+$/) ?? [])[0]?.toLowerCase() ?? "";
  const activeLocalhostRouteIsWritable =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_WRITE_EXTENSIONS.has(activeLocalhostWriteExtension);
  const activeLocalhostSourceWriteContent = resolveLocalhostSourceWriteContent({
    extension: activeLocalhostWriteExtension,
    persistedContent: activeContent,
    liveSnapshotHtml: activeLocalhostSourceSnapshotHtml,
  });
  const activeLocalhostRouteIsCompiledSource =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_COMPILED_SOURCE_EXTENSIONS.has(activeLocalhostWriteExtension);

  if (!id) return null;

  if (
    designLoading ||
    !canvasImagesReady ||
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
    editorSourceAndSync,
  });

  const projectTitleControl = renderProjectTitleControl({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorLiveEditsAndPresence,
    editorLayoutAndStructure,
    editorExportAndHandoff,
    editorSourceAndSync,
    design,
    widgetEmbed,
  });

  const minimalUiToggle = minimalUiLocked ? null : (
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
      editorLayoutAndStructure,
      editorModes,
      editorScreenRendering,
      editorSourceAndSync,
      controlId,
    });

  const signedOutPersistenceActions = renderSignedOutPersistenceActions({
    editorCore,
    editorFilesAndSaving,
    signInToShareHref,
  });
  const renderPendingNodeRewriteControl = (compact: boolean) =>
    renderPendingNodeRewriteButton({
      editorCore,
      editorFilesAndSaving,
      editorModes,
      compact,
    });

  // Preview opens a window outside the host and Publish joins a waitlist the
  // widget's write ticket cannot write, so a widget has neither. A ready
  // Builder app gets its own menu: Publish deploys it instead.
  const publishWaitlistControl = widgetEmbed ? null : fullAppBuildingEnabled &&
    id &&
    fusionApp?.status === "ready" &&
    !hostEmbeddedEditor ? (
    <FusionAppMenu
      designId={id}
      previewUrl={fusionApp.previewUrl}
      editorUrl={fusionApp.editorUrl}
      deployedUrl={fusionApp.deployedUrl}
    />
  ) : (
    renderPublishWaitlistControl({
      editorCore,
      editorGenerationAndAccess,
      editorActiveScreenAndGeometry,
      editorCanvasAndScreens,
      editorScreenInspector,
      editorLayerActions,
    })
  );

  // The controls below live in two places: the top bar (docked editor) and
  // the minimal-UI right bar (which has no top bar). Build each once.
  const presenceControl = hostEmbeddedEditor ? null : (
    <PresenceBar
      activeUsers={mergePresenceUsers(
        currentUser ? [currentUser] : [],
        activeUsers,
        overviewActiveUsers,
      )}
      agentPresent={agentPresent || overviewAgentPresent}
      agentActive={agentActive || overviewAgentActive}
      currentUserEmail={currentUser?.email}
      showCurrentUser
      followingEmail={followingEmail}
      onAvatarClick={handleAvatarClick}
      disableAgentClick
      className="shrink-0"
    />
  );

  const renderReviewFeedbackControl = (compact: boolean) => {
    if (!canEditDesign || reviewAgentQueueCount <= 0) return null;
    const label = reviewFeedbackApplying
      ? t("review.applyingFeedback")
      : t("review.applyFeedback", { count: reviewAgentQueueCount });
    const button = (
      <Button
        type="button"
        variant="outline"
        size="xs"
        data-design-apply-feedback
        aria-label={compact ? label : undefined}
        className="design-focus-ring min-w-0 shrink-0 gap-[var(--design-baseline-half)] [&_svg]:size-3.5"
        onClick={handleApplyReviewFeedback}
        disabled={reviewFeedbackApplying}
      >
        {reviewFeedbackApplying ? (
          <Spinner className="size-3.5" />
        ) : (
          <IconMessageCircle className="size-3.5" />
        )}
        {compact ? (
          <span aria-hidden="true">{reviewAgentQueueCount}</span>
        ) : (
          label
        )}
      </Button>
    );
    if (!compact) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  const shareSegmentClassName =
    "!border-primary !bg-primary !text-primary-foreground shadow-none hover:!border-primary/90 hover:!bg-primary/90 hover:!text-primary-foreground focus-visible:ring-ring [&_svg]:!text-primary-foreground";
  const firstOutputActionsAvailable =
    !hostEmbeddedEditor &&
    !uiHidden &&
    (widgetEmbed
      ? shouldRenderDesignShareControl({
          widgetEmbed,
          canShareDesign,
          canRenderAuthenticatedShare,
        })
      : canRenderAuthenticatedShare);
  const nextStepShareActionEvent = "design:first-output-next-step-share";
  const renderShareControl = (_dense: boolean, actionEvent?: string) => {
    if (hostEmbeddedEditor) return null;
    if (widgetEmbed) {
      if (
        !shouldRenderDesignShareControl({
          widgetEmbed,
          canShareDesign,
          canRenderAuthenticatedShare,
        })
      ) {
        return null;
      }
    } else if (!canRenderAuthenticatedShare) {
      return sessionResolved ? signedOutPersistenceActions : null;
    }

    return (
      <div className="flex shrink-0 items-center [&_[data-slot=button-group]>button+button]:size-[var(--design-control-height)] [&_[data-slot=button-group]>button]:h-[var(--design-control-height)]">
        {canEditDesign && activeOverviewScreen?.sourceType === "localhost" ? (
          <ShareLivePreview
            key={activeOverviewScreen.id}
            designId={id}
            fileId={activeOverviewScreen.id}
            tunnelUrl={activeOverviewScreen.tunnelUrl}
            liveCollaborationEnabled={liveCollaborationEnabled}
          />
        ) : null}
        <ShareButton
          resourceType="design"
          resourceId={id}
          resourceTitle={design.title}
          actionEvent={actionEvent}
          hideTriggerIcon
          defaultOpen={shouldOpenShare}
          shareUrl={editorShareUrl}
          shareUrlLabel={t(
            hasLocalhostScreens
              ? "designEditor.liveCanvasLink"
              : "designEditor.shareEditorLink",
          )}
          shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
          shareTabs={designShareTabs}
          sendTo={designShareSendTo}
          popoverClassName="z-[100010]"
          triggerClassName={cn(
            shareSegmentClassName,
            "px-[var(--design-baseline-unit)] text-xs",
          )}
        />
      </div>
    );
  };

  const localPreviewRow =
    activeScreenIsLocalSource &&
    viewMode === "single" &&
    !activeScreenSnapshotOnly &&
    activeScreenPreviewUrl ? (
      <div className="flex h-[var(--design-row-height)] min-w-0 items-center gap-[var(--design-baseline-half)]">
        <a
          href={activeScreenPreviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[var(--design-control-height)] min-w-0 flex-1 items-center gap-[var(--design-baseline-half)] rounded-md border border-border bg-[var(--design-editor-panel-raised-bg)] px-[var(--design-baseline-unit)] text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={"Open local preview" /* i18n-ignore */}
          title={activeScreenPreviewUrl}
        >
          <IconLink className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono">
            {activeScreenPreviewUrl}
          </span>
          <IconExternalLink className="size-3 shrink-0" />
        </a>
        {(activeLocalhostRouteIsWritable ||
          activeLocalhostRouteIsCompiledSource) &&
        canEditDesign &&
        id ? (
          activeLocalhostRouteIsCompiledSource ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-[var(--design-control-height)]"
                    disabled
                    aria-label={t("designEditor.applyToSource")}
                  >
                    <IconDeviceFloppy className="size-3" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("designEditor.applyToSourceUnavailableCompiled")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-[var(--design-control-height)]"
                  disabled={
                    applyToSourcePending || !activeLocalhostSourceWriteContent
                  }
                  aria-label={
                    applyToSourcePending
                      ? t("designEditor.writingToSource")
                      : t("designEditor.applyToSource")
                  }
                  onClick={handleApplyToSource}
                >
                  {applyToSourcePending ? (
                    <Spinner className="size-3" />
                  ) : (
                    <IconDeviceFloppy className="size-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {!activeLocalhostSourceWriteContent
                  ? NO_LOCALHOST_WRITE_CONTENT_MESSAGE
                  : activeLocalhostRelPath
                    ? t("designEditor.applyToSourcePath", {
                        path: activeLocalhostRelPath,
                      })
                    : t("designEditor.applyToSource")}
              </TooltipContent>
            </Tooltip>
          )
        ) : null}
      </div>
    ) : null;

  const rightSidebarActions = renderRightSidebarActions({
    editorCore,
    editorHistory,
    renderPendingNodeRewriteControl,
    publishWaitlistControl,
    presenceControl,
    renderReviewFeedbackControl,
    renderShareControl: (dense) =>
      renderShareControl(dense, nextStepShareActionEvent),
    localPreviewRow,
    showCommentsToggle: Boolean(editorToolsAndVectors.reviewCommentsPanelProps),
    reviewUnreadCount,
  });
  const commentsPanel =
    editorToolsAndVectors.commentsPanelShown &&
    editorToolsAndVectors.reviewCommentsPanelProps ? (
      <ReviewCommentsPanel
        {...editorToolsAndVectors.reviewCommentsPanelProps}
        onNewThread={() => {
          if (!pinMode) handlePinToolToggle();
        }}
      />
    ) : null;

  const chromeControlsVisible = !initialGenerationChromeLimited;
  // Leaving Interact for Design needs a fresh runtime layer snapshot, same
  // as the Interact bar's own Edit button.
  const handleToolbarModeChange = (next: EditorMode) => {
    if (mode === "interact" && next === "edit") {
      setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
    }
    handleModeChange(next);
  };
  const toolbarZoomControl =
    !chromeControlsVisible ? null : responsiveInteractActive ? (
      <InteractZoomControl
        zoom={interactZoom}
        choice={interactZoomChoice}
        onChange={handleInteractZoomChange}
      />
    ) : (
      renderZoomControl("toolbar")
    );

  const interactControlArgs = {
    editorActiveScreenAndGeometry,
    editorModes,
    activeScreenId: activeFile?.id ?? null,
  };
  const activeUrlScreen =
    mode === "edit" &&
    !responsiveInteractActive &&
    !minimalUi &&
    !uiHidden &&
    !isVisualEditSurface &&
    !embedded
      ? resolveUrlScreen({
          screen: overviewScreens.find(
            (screen) => screen.id === activeFile?.id,
          ),
          fallbackSourceType: designSourceType,
          liveRoutePath: activeFile
            ? liveRoutePathsByScreenId[activeFile.id]
            : undefined,
        })
      : null;
  const interactFloatingBar =
    hostOwnsChrome ? null : responsiveInteractActive ? (
      renderInteractFloatingBar(interactControlArgs)
    ) : activeUrlScreen ? (
      <div
        data-design-url-screen-floating
        className="pointer-events-auto flex h-10 min-w-0 items-center rounded-lg border border-border bg-[var(--design-editor-panel-bg)] px-2 shadow-xl"
      >
        <UrlScreenControls
          screen={activeUrlScreen}
          onReload={handleScreenReload}
        />
      </div>
    ) : null;

  const leftContentWidth = resolveLeftSidebarWidth(leftSidebarWidth);
  const leftSidebarVisible = !hostOwnsChrome && !uiHidden && !minimalUi;
  const leftChromeOverlayInset = leftSidebarVisible
    ? `${leftContentWidth}px`
    : undefined;
  const minimalInspectorHasSelection = hasMinimalInspectorSelection({
    selectedElement,
    selectedLayerIds,
    selectedScreenGeometry,
  });
  // Below md the docked inspector panel is display:none and the Sheet below
  // carries it, so the panel must neither inset the canvas nor displace the
  // toolbar. Minimal UI floats the panel at every width instead.
  const rightSidebarVisible = isRightInspectorVisible({
    hostOwnsChrome,
    isMobileViewport,
    uiHidden,
    initialGenerationChromeLimited,
    responsiveInteractActive,
    minimalUi,
    minimalInspectorHasSelection,
    commentsPanelShown: editorToolsAndVectors.commentsPanelShown,
  });
  const questionFlowInsetRight = rightInspectorCanvasInset({
    visible: rightSidebarVisible,
    width: rightSidebarWidth,
    minimalUi,
  });
  const chromeInsetLeft = leftSidebarVisible ? leftContentWidth : 0;
  const leftDrawerCoversCanvas = isMobileViewport && leftSidebarVisible;
  const selectedRouteScreen = overviewScreens.find(
    (screen) => screen.id === selectedScreenGeometry?.id,
  );
  const alignDisabledReasonKey = alignAvailability.canAlign
    ? null
    : layoutMoveRefusalMessageKey(alignAvailability.blocker);
  const alignDisabledReason = alignDisabledReasonKey
    ? t(alignDisabledReasonKey)
    : undefined;
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
    selectedScreenRoute: selectedRouteScreen
      ? resolveScreenRoute(
          selectedRouteScreen,
          liveRoutePathsByScreenId[selectedRouteScreen.id],
        )
      : undefined,
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
    onRemoveScreen: canEditDesign ? handleRemoveSelectedScreen : undefined,
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
            meta?.phase === "preview"
              ? "preview"
              : meta?.phase === "cancel"
                ? "cancel"
                : "commit",
          )
      : undefined,
    selectionColorScopes,
    readSubtreeColorStyles: readSelectionSubtreeColorStyles,
    onSelectionColorTarget: handleSelectionColorTarget,
    canSelectSelectionColorTarget,
    onSelectionColorChange: canEditActiveVisualScreen
      ? handleSelectionColorChange
      : undefined,
    onSelectionColorPickerOpenChange: canEditActiveVisualScreen
      ? handleSelectionColorPickerOpenChange
      : undefined,
    viewMode,
    mode,
    files: documentColorFiles,
    tweaks,
    tweakValues: tweakSelections,
    onTweakChange:
      canEditDesign && tweakMutationsEnabled ? handleTweakChange : undefined,
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
    activeContent,
    pendingInteractionStateStyles: pendingInspectorInteractionStateStyles,
    activeFileUpdatedAt: activeFile?.updatedAt ?? null,
    getComponentExpectedFiles,
    componentDetailsReady,
    componentSwapPickerRequest,
    onComponentPropApplied: handleComponentPropApplied,
    onShaderSourceApplied: handleShaderSourceApplied,
    onShaderSourceEdit: handleShaderSourceEdit,
    onFontUploaded:
      canEditActiveVisualScreen && activeCanvasSourceType === "inline"
        ? handleFontUploaded
        : undefined,
    onStyleChange: handleStyleChange,
    onStylesChange: handleStylesChange,
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
    onGoToMainComponent: selectedInstanceActionNodeId
      ? handleGoToMainComponentMenuAction
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
    onAlignSelection: canEditDesign ? handleAlignSelection : undefined,
    alignSelectionDisabled: !alignAvailability.canAlign,
    alignSelectionDisabledReason: alignDisabledReason,
    onDisableAutoLayout: canEditDesign ? handleDisableAutoLayout : undefined,
    onApplyLayoutFlow: canEditDesign ? handleApplyLayoutFlow : undefined,
    onInteractionStateChange: handleInteractionStateChange,
  };

  return (
    <div
      data-design-editor
      className="relative flex h-full flex-col overflow-hidden bg-[var(--design-editor-canvas-bg)]"
    >
      {id ? <VisualEditWebMcp getPrompt={visualEditPromptResult} /> : null}
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
                getDesignHostChannel().send({ type: "design:close" });
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
      <div className="flex-1 flex overflow-hidden relative">
        {renderLeftSidebar({
          editorCore,
          editorHistory,
          editorGenerationAndAccess,
          editorFilesAndSaving,
          editorCanvasAndScreens,
          editorLiveEditsAndPresence,
          editorContentAndComponents,
          editorSelectionAndStyles,
          editorClipboard,
          editorModes,
          editorExportAndHandoff,
          editorLayerModels,
          editorLayerActions,
          editorSourceAndSync,
          id,
          canApplyPendingVisualEditsWithAgent,
          projectMenu,
          projectTitleControl,
          saveStatus: chromeControlsVisible ? (
            <SaveStatusIndicator
              unsavedChangeCount={unsavedChangeCount}
              onRetry={retryUnsavedChanges}
            />
          ) : null,
          minimalUiToggle,
          leftContentWidth,
          leftSidebarVisible,
        })}

        {!hostOwnsChrome &&
          designBottomToolbarMode === "editor" &&
          design &&
          !questionFlowActive &&
          !leftDrawerCoversCanvas && (
            <DesignBottomToolbar
              mode={mode}
              pinMode={pinMode}
              activeTool={activeTool}
              hasActiveFile={Boolean(activeFile)}
              frameToolDraws={frameToolDraws}
              onFrameToolDrawsChange={setFrameToolDraws}
              onMove={handleMoveTool}
              onHand={handleHandTool}
              onScale={handleScaleTool}
              onFrame={handleFrameTool}
              onText={handleTextTool}
              onShape={handleShapeTool}
              onMediaFiles={handleDesignMediaFiles}
              onPen={handlePenTool}
              onCommentPin={handlePinToolToggle}
              canComment={canCommentDesign}
              onModeChange={handleToolbarModeChange}
              showModeTabs
              zoomControl={toolbarZoomControl}
            />
          )}

        {!hostOwnsChrome ? (
          <KeyboardShortcutsDialog
            open={keyboardShortcutsOpen}
            onClose={handleCloseKeyboardShortcuts}
          />
        ) : null}

        {!hostOwnsChrome ? (
          <NudgeAmountDialog
            open={nudgeAmountOpen}
            onClose={handleCloseNudgeAmount}
            nudgeAmounts={editorPreferences.nudge}
            onNudgeAmountsChange={(nudge) =>
              setEditorPreferences({ ...editorPreferences, nudge })
            }
          />
        ) : null}

        {questionFlowActive ? (
          <div
            className="relative mx-1 h-full min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--design-editor-panel-bg)]"
            style={{
              paddingLeft: leftChromeOverlayInset,
              paddingRight: questionFlowInsetRight,
            }}
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
            leftChromeOverlayInset,
            rightSidebarVisible,
            chromeInsetLeft,
          })
        )}

        {renderRightRail({
          editorCore,
          editorHistory,
          editorContentAndComponents,
          projectTitleControl,
          minimalUiToggle,
          rightSidebarActions,
          interactFloatingBar,
          rightSidebarVisible,
          floatingHeadAllowed: chromeControlsVisible,
          leftDrawerCoversCanvas,
          leftInset: chromeInsetLeft,
          commentsPanel,
          editPanelProps,
        })}
      </div>

      <DesignFirstOutputNextStep
        key={id}
        outputId={id}
        actionsAvailable={firstOutputActionsAvailable}
        {...(session && (session.userId ?? session.email)
          ? { userScope: session.userId ?? session.email }
          : {})}
        generationActive={generating}
        outputReady={getActiveFileId(activeFile) !== undefined}
        labels={{
          ariaLabel: t("home.nextStepBar.ariaLabel"),
          refineWithPrompt: t("home.nextStepBar.refineWithPrompt"),
          export: t("home.nextStepBar.export"),
          shareLink: t("home.nextStepBar.shareLink"),
          dismiss: t("home.nextStepBar.dismiss"),
        }}
        onRefine={() =>
          window.dispatchEvent(
            new CustomEvent("agent-panel:open", { detail: { focus: true } }),
          )
        }
        onExport={() =>
          window.dispatchEvent(
            new CustomEvent(nextStepShareActionEvent, {
              detail: { tab: "export" },
            }),
          )
        }
        onShareLink={() =>
          window.dispatchEvent(
            new CustomEvent(nextStepShareActionEvent, {
              detail: { tab: "share" },
            }),
          )
        }
      />

      {isMobileViewport &&
      !minimalUi &&
      !hostOwnsChrome &&
      !uiHidden &&
      editorToolsAndVectors.reviewCommentsPanelProps ? (
        <MobileCommentsSheet
          open={commentsPanelOpen && !pinMode}
          onClose={() => setCommentsPanelOpen(false)}
          title={t("designEditor.columnHead.comments")}
        >
          <ReviewCommentsPanel
            {...editorToolsAndVectors.reviewCommentsPanelProps}
            onNewThread={() => {
              if (!pinMode) handlePinToolToggle();
            }}
          />
        </MobileCommentsSheet>
      ) : null}

      {renderMobileInspectorSheet({
        editorCore,
        editorHistory,
        editorLiveEditsAndPresence,
        editorContentAndComponents,
        editPanelProps,
      })}

      <input
        ref={editorSourceAndSync.importFileInputRef}
        type="file"
        accept={importFormatsAccept(DESIGN_IMPORT_FORMATS)}
        className="hidden"
        onChange={editorSourceAndSync.handleImportFileChange}
      />

      {renderEditorDialogs({
        editorCore,
        editorHistory,
        editorClipboard,
        editorLayoutAndStructure,
        editorSourceAndSync,
        editorExportAndHandoff,
        id,
        pendingVisualStyleWarningOpen,
      })}

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

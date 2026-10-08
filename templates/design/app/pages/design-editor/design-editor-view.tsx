import { CreativeContextShareTab } from "@agent-native/creative-context/client";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import { maxPenCornerRadius } from "@shared/pen-path";
import {
  IconArrowsDown,
  IconX,
  IconCode,
  IconArchive,
  IconPhoto,
  IconCheck,
  IconDownload,
  IconClipboard,
  IconLayoutSidebar,
  IconDeviceFloppy,
  IconExternalLink,
  IconTerminal2,
  IconLink,
  IconMessageCircle,
} from "@tabler/icons-react";

import { BreakpointDeviceControl } from "@/components/design/BreakpointBar";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import { DesignBottomToolbar } from "@/components/design/editor/DesignBottomToolbar";
import { EditorTopBar } from "@/components/design/editor/EditorTopBar";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ResponsiveEditScope, ShareExportFormat } from "./command-types";
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
  LOCALHOST_COMPILED_SOURCE_EXTENSIONS,
  LOCALHOST_WRITE_EXTENSIONS,
  NO_LOCALHOST_WRITE_CONTENT_MESSAGE,
} from "./editor-constants";
import {
  buildSignInHrefForComment,
  buildSignInHrefForDesignIntent,
} from "./editor-helpers";
import { resolveLocalhostSourceWriteContent } from "./editor-state";
import { hasMinimalInspectorSelection } from "./minimal-inspector";
import { mergePresenceUsers } from "./presence-users";
import { getDesignBottomToolbarMode } from "./tool-state";
import { TOP_BAR_HEIGHT_PX, isTopBarVisible } from "./top-bar";
import { type EditorMode, SHOW_DESIGN_SECONDARY_LEFT_PANELS } from "./types";
import { renderEditorCanvasArea } from "./view/editor-canvas-area";
import { renderEditorDialogs } from "./view/editor-dialogs";
import { renderLeftSidebar } from "./view/left-sidebar";
import { renderMobileInspectorSheet } from "./view/mobile-inspector-sheet";
import { renderMotionDockPanel } from "./view/motion-dock-panel";
import { renderNodeRewriteAndLocalhostDialogs } from "./view/node-rewrite-and-localhost-dialogs";
import { renderPendingNodeRewriteButton } from "./view/pending-node-rewrite-button";
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

/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */

// Mirrors `--design-chrome-rail-width` in app/global.css (8 baseline units ×
// 8px). The rail is always-on chrome (not measured via a ref) so the very
// first overview camera render — before any layout effect could measure the
// DOM — already accounts for it; see chromeInsetLeft below.
const DESIGN_CHROME_RAIL_WIDTH_PX = 64;

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
    sessionResolved,
    shellMode,
    embedded,
    isVisualEditSurface,
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
    rightSidebarWidth,
    minimalUi,
    isMobileViewport,
    activeBreakpointWidthState,
    handleInteractionStateChange,
  } = editorHistory;
  const {
    setRuntimeLayerSnapshotRequest,
    drawMode,
    pinMode,
    reviewFeedbackApplying,
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
    canShareDesign,
    canEditDesign,
    canCommentDesign,
    canRenderAuthenticatedShare,
    liveCollaborationSaving,
    liveCollaborationEnabled,
    handleLiveCollaborationChange,
    canEditPublicLiveScreenUrl,
    tweaksEnabled,
    reviewUnreadCount,
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
    creativeContextEnabled,
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
    hasLocalhostScreens,
    editorShareUrl,
  } = editorFilesAndSaving;
  const {
    responsiveEditScope,
    activeFile,
    designBreakpoints,
    handleBreakpointBarSelect,
    handleResponsiveEditScopeChange,
    activeScreenBaseWidthPx,
    activeScreenSnapshotOnly,
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
    codingHandoffLoading,
    handleCopyCodingHandoff,
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
    codingHandoffPreviewText,
    selectedLayerIds,
    handleShaderEditCode,
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
    handleSelectionColorChange,
    handleSelectionColorPickerOpenChange,
    canSelectSelectionColorTarget,
    handleGroupFillStylesChange,
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
    handleDrawTool,
    pendingVisualStyleNavigationBlocker,
    activeLocalhostConnectionId,
    activeLocalhostConnectionResult,
    componentRuntime,
    requestLocalhostWrite,
    workbenchLocalhostConnections,
  } = editorSourceAndSync;
  const {
    applyToSourcePending,
    handleApplyToSource,
    handleBreakpointBarAdd,
    handleBreakpointChangeWidth,
  } = editorScreenRendering;
  const signInToShareHref = buildSignInHrefForDesignIntent("share");
  const canApplyPendingVisualEditsWithAgent =
    canEditDesign && (isSignedIn || hostEmbeddedEditor || pageHasWebMcpHost());

  const shouldOpenShare = postAuthIntent === "share" && canShareDesign;
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
      disabled: !activeFile || exportHtmlMutation.isPending,
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
      disabled: !activeFile || pngExporting,
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
      disabled: !activeFile || svgExporting,
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
      disabled: !activeFile || exportZipMutation.isPending,
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
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {shareExportOptions.map((option) => {
          const selected = option.value === shareExportFormat;
          const ExportIcon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setShareExportFormat(option.value)}
              className={cn(
                "relative flex min-h-[76px] items-start gap-2.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-2.5 text-left transition-colors hover:bg-[var(--design-editor-panel-raised-bg)]",
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
  const shareSendToTab = (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 shadow-sm">
        <div className="flex h-8 items-center border-b border-neutral-800 px-3">
          <div className="flex items-center gap-2">
            {/* guard:allow-raw-color — the terminal illustration's window controls are fixed colors */}
            <span className="size-2.5 rounded-full bg-red-500" />
            <span className="size-2.5 rounded-full bg-yellow-400" />
            {/* guard:allow-raw-color — the terminal illustration's window controls are fixed colors */}
            <span className="size-2.5 rounded-full bg-green-500" />
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-neutral-400">
            {"Your agent" /* i18n-ignore terminal title */}
          </div>
          <IconTerminal2 className="size-3.5 text-neutral-500" />
        </div>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5 text-neutral-100">
          {`> ${codingHandoffPreviewText}`}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void handleCopyCodingHandoff()}
          disabled={codingHandoffLoading}
          className="h-8 gap-1.5 rounded-md px-3 text-[12px]"
        >
          <IconClipboard className="size-3.5" />
          {"Copy agent prompt" /* i18n-ignore share send action */}
        </Button>
      </div>
    </div>
  );
  const designSharePopoverClassName =
    "z-[100010] !w-[min(620px,calc(100vw-32px))] !p-3 " +
    "[&_[role=tablist]]:!inline-flex [&_[role=tablist]]:!w-fit [&_[role=tablist]]:!max-w-full [&_[role=tablist]]:!self-start [&_[role=tablist]]:!overflow-x-auto [&_[role=tablist]]:justify-start [&_[role=tablist]]:gap-1 [&_[role=tablist]]:rounded-lg [&_[role=tablist]]:border [&_[role=tablist]]:border-[var(--design-editor-panel-divider-color)] [&_[role=tablist]]:bg-[var(--design-editor-panel-raised-bg)] [&_[role=tablist]]:p-1 " +
    "[&_[role=tab]]:!h-8 [&_[role=tab]]:!flex-none [&_[role=tab]]:rounded-md [&_[role=tab]]:px-3 [&_[role=tab]]:!text-[12px] [&_[role=tab]]:font-semibold [&_[role=tab]]:shadow-none [&_[role=tab]]:ring-0 " +
    "[&_[role=tab]:hover]:text-foreground " +
    "[&_[role=tab][aria-selected=true]]:!bg-background dark:[&_[role=tab][aria-selected=true]]:!bg-[var(--design-editor-panel-bg)] [&_[role=tab][aria-selected=true]]:text-foreground";
  const designShareTabs = {
    shareLabel: "Share link" /* i18n-ignore share tab label */,
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: t("designEditor.export"),
        content: shareExportTab,
      },
      {
        value: "send",
        label: "Send to agent" /* i18n-ignore share tab label */,
        content: shareSendToTab,
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
      ...(creativeContextEnabled
        ? [
            {
              value: "context",
              label: t("creativeContext.share.tabLabel", {
                defaultValue: "Context",
              }),
              content: (
                <CreativeContextShareTab
                  resource={{
                    appId: "design",
                    resourceType: "design",
                    resourceId: id ?? "",
                    title: design?.title ?? "Untitled design",
                    updatedAt: design?.updatedAt ?? undefined,
                    preview: { kind: "document", label: "Design project" }, // i18n-ignore share-tab preview descriptor, template pages are raw-English
                  }}
                />
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
        workbenchLocalhostConnections[0]?.connectionId
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
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorLiveEditsAndPresence,
    editorLayoutAndStructure,
    editorContentAndComponents,
    editorExportAndHandoff,
    editorSourceAndSync,
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

  const renderZoomControl = (controlId: "toolbar" | "inspector" | "topbar") =>
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
  const renderPendingNodeRewriteControl = (compact: boolean) =>
    renderPendingNodeRewriteButton({
      editorCore,
      editorFilesAndSaving,
      editorModes,
      compact,
    });

  const publishWaitlistControl = renderPublishWaitlistControl({
    editorCore,
    editorGenerationAndAccess,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorScreenInspector,
    editorLayerActions,
  });

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

  const reviewFeedbackControl =
    canEditDesign && reviewAgentQueueCount > 0 ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-[var(--design-row-height)] gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-xs"
        onClick={handleApplyReviewFeedback}
        disabled={reviewFeedbackApplying}
      >
        {reviewFeedbackApplying ? (
          <Spinner className="size-3.5" />
        ) : (
          <IconMessageCircle className="size-3.5" />
        )}
        {reviewFeedbackApplying
          ? t("review.applyingFeedback")
          : t("review.applyFeedback", { count: reviewAgentQueueCount })}
      </Button>
    ) : null;

  const renderShareControl = (dense: boolean) =>
    hostEmbeddedEditor ? null : canRenderAuthenticatedShare ? (
      <ShareButton
        resourceType="design"
        resourceId={id}
        resourceTitle={design.title}
        hideTriggerIcon
        defaultOpen={shouldOpenShare}
        shareUrl={editorShareUrl}
        shareUrlLabel={t(
          hasLocalhostScreens
            ? "designEditor.liveCanvasLink"
            : "designEditor.shareEditorLink",
        )}
        shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
        roleCopy={{
          commenter: {
            label: t("designEditor.commenterRoleLabel"),
            description: t("designEditor.commenterRoleDescription"),
          },
        }}
        shareTabs={designShareTabs}
        popoverClassName={designSharePopoverClassName}
        triggerClassName={cn(
          dense
            ? "h-[var(--design-control-height)] px-[var(--design-baseline-unit)] text-xs"
            : "h-[var(--design-row-height)] px-[calc(var(--design-baseline-unit)*1.5)] text-sm",
          "rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]",
        )}
      />
    ) : sessionResolved ? (
      signedOutPersistenceActions
    ) : null;

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

  // Minimal UI hides the top bar, so its floating right bar carries the same
  // controls.
  const rightSidebarActions = renderRightSidebarActions({
    editorCore,
    editorHistory,
    renderZoomControl,
    renderPendingNodeRewriteControl,
    publishWaitlistControl,
    presenceControl,
    reviewFeedbackControl,
    renderShareControl,
    localPreviewRow,
  });

  const topBarVisible = isTopBarVisible({
    embedded,
    isVisualEditSurface,
    minimalUi,
    uiHidden,
  });
  const topBarControlsVisible = !initialGenerationChromeLimited;
  // The mode switch used to live in the bottom toolbar, so it keeps that
  // toolbar's gating.
  const topBarShowsModes =
    designBottomToolbarMode === "editor" && design && !questionFlowActive;
  // Leaving Interact for Design needs a fresh runtime layer snapshot, same
  // as the Interact bar's own Edit button.
  const handleTopBarModeChange = (next: EditorMode) => {
    if (mode === "interact" && next === "edit") {
      setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
    }
    handleModeChange(next);
  };
  const topBarActions = (
    <>
      {renderPendingNodeRewriteControl(isMobileViewport)}
      {reviewFeedbackControl}
      {publishWaitlistControl}
      {renderShareControl(true)}
    </>
  );

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
  const chromeInsetLeft = leftSidebarVisible
    ? DESIGN_CHROME_RAIL_WIDTH_PX + (activeLeftPanel ? leftContentWidth : 0)
    : 0;
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
      <div
        className="flex-1 flex overflow-hidden relative"
        style={topBarVisible ? { paddingTop: TOP_BAR_HEIGHT_PX } : undefined}
      >
        {/* ── Render: top bar (canvas + inspector columns) ── */}
        {topBarVisible ? (
          <EditorTopBar
            mode={mode}
            onModeChange={handleTopBarModeChange}
            modes={topBarShowsModes ? undefined : []}
            zoomControl={
              topBarControlsVisible && !responsiveInteractActive
                ? renderZoomControl("topbar")
                : null
            }
            presence={topBarControlsVisible ? presenceControl : null}
            actions={topBarControlsVisible ? topBarActions : null}
            leftInset={chromeInsetLeft}
            narrowLeftInset={
              leftSidebarVisible ? DESIGN_CHROME_RAIL_WIDTH_PX : 0
            }
            inspectorWidth={rightSidebarVisible ? rightSidebarWidth : undefined}
          />
        ) : null}
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
          topBarVisible,
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
          <div
            className="pointer-events-none absolute right-0 top-0 z-[80] flex h-12 items-center border-b border-border bg-[var(--design-editor-panel-bg)] pl-1 pr-3"
            style={topBarVisible ? { top: TOP_BAR_HEIGHT_PX } : undefined}
          >
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
              showModeTabs={!topBarVisible}
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
            leftChromeOverlayInset,
            rightSidebarVisible,
            chromeInsetLeft,
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
          localPreviewRow,
          rightSidebarActions,
          topBarVisible,
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

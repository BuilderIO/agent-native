import { AgentChatSurface } from "@agent-native/toolkit/app/chat";
import { IconClipboard } from "@tabler/icons-react";
import type { ReactElement } from "react";
import { Link } from "react-router";

import { CodeWorkbenchLoader } from "@/components/design/code-workbench/CodeWorkbenchLoader";
import {
  AssetLibraryPanel,
  DesignExtensionsPanel,
} from "@/components/design/DesignExtensionsPanel";
import { DesignImportPanel } from "@/components/design/DesignImportPanel";
import {
  DesignWorkspaceRail,
  INITIAL_GENERATION_DISABLED_LEFT_PANELS,
} from "@/components/design/editor/DesignWorkspaceRail";
import { ReadOnlyEditorPanel } from "@/components/design/editor/ReadOnlyEditorPanel";
import { FirstRunStart } from "@/components/design/FirstRunStart";
import { LayersPanel } from "@/components/design/LayersPanel";
import { TokensPanel } from "@/components/design/TokensPanel";
import { DesignComposerContextProvider } from "@/components/editor/DesignComposerContextProvider";
import { FigmaLinkComposerBubble } from "@/components/editor/FigmaLinkComposerBubble";
import { DESIGN_CHAT_STORAGE_KEY } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

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
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorModes } from "../domains/use-editor-modes";
import type { EditorSelectionAndStyles } from "../domains/use-editor-selection-and-styles";
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";
import type { EditorToolsAndVectors } from "../domains/use-editor-tools-and-vectors";
import {
  SHOW_DESIGN_SECONDARY_LEFT_PANELS,
  SHOW_DESIGN_CODE_LEFT_PANEL,
} from "../types";

export function renderLeftSidebar({
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
  editorEditCommands: EditorEditCommands;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerModels: EditorLayerModels;
  editorLayerActions: EditorLayerActions;
  editorSourceAndSync: EditorSourceAndSync;
  id: string;
  canApplyPendingVisualEditsWithAgent: boolean;
  projectMenu: ReactElement;
  projectTitleControl: ReactElement;
  minimalUiToggle: ReactElement;
  topBarVisible: boolean;
  leftContentWidth: number;
  leftSidebarVisible: boolean;
}) {
  const {
    searchParams,
    hostEmbeddedEditor,
    activeFileId,
    viewMode,
    attachHostChatSlot,
    isSignedIn,
    t,
    designChatScope,
    designChatHistory,
    handleComposerTextChange,
    detectedFigmaComposerLink,
    isVisualEditSurface,
    shellMode,
  } = editorCore;
  const {
    activeLeftPanel,
    motionDockOpen,
    setMotionDockOpenAnimated,
    setActiveLeftPanel,
    leftSidebarContentRef,
    layerPanelExpandedIds,
    setExpandedLayerIds,
    codeWorkbenchOpenedRef,
    startSidebarResize,
  } = editorHistory;
  const { canEditDesign, browserTabId } = editorGenerationAndAccess;
  const { handleTokensApplied } = editorFilesAndSaving;
  const { activeFile } = editorActiveScreenAndGeometry;
  const { handleLayerLeave } = editorCanvasAndScreens;
  const {
    initialGenerationChromeLimited,
    resolveAssetScreenPoint,
    selectedElementLayerId,
    selectedCanvasSelector,
  } = editorLiveEditsAndPresence;
  const { hoveredCodeLayerNode } = editorContentAndComponents;
  const { setActiveCodeFile } = editorToolsAndVectors;
  const { designExtensionContext } = editorSelectionAndStyles;
  const { showPastedImagesNotice } = editorClipboard;
  const { handleDeleteInlineFile } = editorEditCommands;
  const { handleSidebarScreenSelect, handleSidebarScreenOverview } =
    editorModes;
  const { layersPanelRef } = editorExportAndHandoff;
  const {
    designIsEmpty,
    chatMessageCount,
    layerPanelFiles,
    overviewLayerPanelFiles,
    singleBlankScreenLayerPanelFiles,
    activeLayerPanelNodes,
    layerPanelSelectedIds,
    layersSearchQuery,
    setLayersSearchQuery,
    boardElements,
    designAgentSuggestions,
    designAgentSuggestionConfig,
    setChatMessageCount,
  } = editorLayerModels;
  const { handleAddScreenAffordance, layerPanelCallbacks } = editorLayerActions;
  const {
    firstRunTemplates,
    firstRunTemplatesQuery,
    applyingTemplateId,
    handleFirstRunTemplate,
    workbenchLocalhostConnections,
    handleWorkbenchLocalWriteConsent,
    importPanelRef,
  } = editorSourceAndSync;

  const showFirstRunStart = designIsEmpty && chatMessageCount === 0;
  const routeCodeFileId =
    activeLeftPanel === "code" ? searchParams.get("fileId") : null;
  const routeCodeFilename =
    activeLeftPanel === "code" ? searchParams.get("filename") : null;

  return (
    <>
      {leftSidebarVisible ? (
        <div
          data-design-chrome-region="left-shell"
          className="absolute inset-y-0 left-0 z-[70] flex min-h-0 bg-[var(--design-editor-panel-bg)]"
        >
          <DesignWorkspaceRail
            activePanel={activeLeftPanel}
            disabledPanels={
              initialGenerationChromeLimited
                ? INITIAL_GENERATION_DISABLED_LEFT_PANELS
                : undefined
            }
            motionOpen={motionDockOpen}
            motionDisabled={!activeFile || initialGenerationChromeLimited}
            projectMenu={hostEmbeddedEditor ? null : projectMenu}
            onMotionToggle={() => setMotionDockOpenAnimated(!motionDockOpen)}
            onPanelChange={(panel) => {
              if (panel === null && initialGenerationChromeLimited) return;
              setActiveLeftPanel(panel);
            }}
          />
          <div
            ref={leftSidebarContentRef}
            aria-hidden={activeLeftPanel === null}
            className={cn(
              "flex min-h-0 max-w-[calc(100dvw-var(--design-chrome-rail-width))] shrink-0 flex-col overflow-hidden border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] transition-[width] duration-150 ease-out md:max-w-none",
              activeLeftPanel === null &&
                "pointer-events-none invisible border-r-0",
            )}
            style={{ width: activeLeftPanel ? leftContentWidth : 0 }}
          >
            <div
              className={cn(
                "min-h-0 flex-1 flex-col overflow-hidden",
                activeLeftPanel === "file" ? "flex" : "hidden",
              )}
            >
              <div
                data-design-chrome-region="left-header"
                className={cn(
                  "flex shrink-0 items-center gap-[var(--design-baseline-half)] px-[var(--design-baseline-unit)]",
                  topBarVisible ? "h-12" : "h-[var(--design-section-height)]",
                  hostEmbeddedEditor && "border-b border-border",
                )}
              >
                {projectTitleControl}
                {minimalUiToggle}
              </div>
              {hostEmbeddedEditor ? null : (
                <div className="-mt-1.5 flex shrink-0 items-center border-b border-border px-[var(--design-baseline-unit)] pb-1.5">
                  <Link
                    to="/home"
                    className="-mx-1 rounded px-1 text-[11px] leading-4 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  >
                    {t("designEditor.fileMenu.designs")}
                  </Link>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <LayersPanel
                  ref={layersPanelRef}
                  screens={layerPanelFiles}
                  activeScreenId={activeFileId ?? undefined}
                  screenOverviewActive={viewMode === "overview"}
                  files={
                    viewMode === "overview"
                      ? overviewLayerPanelFiles
                      : singleBlankScreenLayerPanelFiles
                  }
                  layers={
                    viewMode === "overview" || singleBlankScreenLayerPanelFiles
                      ? undefined
                      : activeLayerPanelNodes
                  }
                  selectedIds={layerPanelSelectedIds}
                  expandedIds={layerPanelExpandedIds}
                  searchQuery={layersSearchQuery}
                  onScreenSelect={handleSidebarScreenSelect}
                  onScreenOverview={handleSidebarScreenOverview}
                  onAddScreen={
                    canEditDesign ? handleAddScreenAffordance : undefined
                  }
                  onSearchQueryChange={setLayersSearchQuery}
                  onExpandedIdsChange={setExpandedLayerIds}
                  onLeaveLayer={handleLayerLeave}
                  boardElements={
                    viewMode === "overview" ? boardElements : undefined
                  }
                  hoveredLayerId={hoveredCodeLayerNode?.id ?? null}
                  {...layerPanelCallbacks}
                />
              </div>
            </div>
            <div
              data-design-agent-panel
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                activeLeftPanel === "agent" ? "flex" : "hidden",
              )}
            >
              {hostEmbeddedEditor ? (
                <div ref={attachHostChatSlot} className="min-h-0 flex-1" />
              ) : canApplyPendingVisualEditsWithAgent ? (
                <AgentChatSurface
                  composerContextProvider={
                    isSignedIn ? DesignComposerContextProvider : undefined
                  }
                  mode="panel"
                  className="min-h-0 min-w-0 flex-1 border-0 bg-transparent shadow-none"
                  chatOnly={true}
                  onCollapse={() => setActiveLeftPanel(null)}
                  storageKey={DESIGN_CHAT_STORAGE_KEY}
                  emptyStateText={t("chat.emptyState")}
                  suggestions={designAgentSuggestions}
                  dynamicSuggestions={designAgentSuggestionConfig}
                  scope={designChatScope}
                  chatHistory={designChatHistory}
                  isolateHistoryByScope={true}
                  showScopeBadge={false}
                  showHeader={true}
                  showTabBar={true}
                  browserTabId={browserTabId}
                  onComposerTextChange={handleComposerTextChange}
                  onMessageCountChange={setChatMessageCount}
                  emptyStateFooter={
                    showFirstRunStart ? (
                      <FirstRunStart
                        templates={firstRunTemplates}
                        templatesLoading={firstRunTemplatesQuery.isLoading}
                        applyingTemplateId={applyingTemplateId}
                        onPickTemplate={(templateId) => {
                          void handleFirstRunTemplate(templateId);
                        }}
                      />
                    ) : null
                  }
                  composerSlot={
                    <>
                      {detectedFigmaComposerLink ? (
                        <FigmaLinkComposerBubble
                          link={detectedFigmaComposerLink}
                          designId={id}
                        />
                      ) : null}
                    </>
                  }
                />
              ) : isVisualEditSurface &&
                !canApplyPendingVisualEditsWithAgent ? (
                <div
                  data-design-public-agent-empty-state
                  className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center"
                >
                  <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <IconClipboard className="size-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {t("designEditor.pendingVisualStyles.copyPrompt")}
                  </p>
                  <p className="mt-1 max-w-56 text-xs leading-5 text-muted-foreground">
                    {t("designEditor.pendingVisualStyles.agentMessage")}
                  </p>
                </div>
              ) : (
                <ReadOnlyEditorPanel
                  title={"Agent chat requires editor access" /* i18n-ignore */}
                  description={
                    "Ask an owner for edit access before using the agent to change this design." /* i18n-ignore */
                  }
                />
              )}
            </div>
            {SHOW_DESIGN_SECONDARY_LEFT_PANELS ? (
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "assets" ? "flex" : "hidden",
                )}
              >
                <div className="flex h-[var(--design-section-height)] shrink-0 items-center border-b border-border/60 px-[var(--design-baseline-unit)]">
                  <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                    {t("designEditor.leftRail.assets")}
                  </h3>
                </div>
                {canEditDesign ? (
                  <AssetLibraryPanel
                    context={designExtensionContext}
                    resolveScreenPoint={resolveAssetScreenPoint}
                  />
                ) : (
                  <ReadOnlyEditorPanel
                    title={"Assets require editor access" /* i18n-ignore */}
                    description={
                      "Ask an owner for edit access before inserting assets into this design." /* i18n-ignore */
                    }
                  />
                )}
              </div>
            ) : null}
            <div
              className={cn(
                "min-h-0 flex-1 flex-col overflow-hidden",
                activeLeftPanel === "import" ? "flex" : "hidden",
              )}
            >
              {canEditDesign ? (
                <DesignImportPanel
                  ref={importPanelRef}
                  context={designExtensionContext}
                  onImport={(result) => {
                    const count = result.unresolvedImageRefCount ?? 0;
                    if (count > 0 && result.files?.length) {
                      showPastedImagesNotice({
                        count,
                        fileIds: result.files.map((f) => f.id),
                      });
                    }
                  }}
                />
              ) : (
                <ReadOnlyEditorPanel
                  title={"Import requires editor access" /* i18n-ignore */}
                  description={
                    "Ask an owner for edit access before importing files into this design." /* i18n-ignore */
                  }
                />
              )}
            </div>
            {SHOW_DESIGN_SECONDARY_LEFT_PANELS ? (
              <>
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col overflow-hidden",
                    activeLeftPanel === "tools" ? "flex" : "hidden",
                  )}
                >
                  {canEditDesign && !shellMode ? (
                    <DesignExtensionsPanel
                      context={designExtensionContext}
                      hideAssetLibrary
                      title={t("designEditor.leftRail.tools")}
                    />
                  ) : (
                    <ReadOnlyEditorPanel
                      title={"Tools require editor access" /* i18n-ignore */}
                      description={
                        "Ask an owner for editor access before running tools for this design." /* i18n-ignore */
                      }
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col overflow-hidden",
                    activeLeftPanel === "tokens" ? "flex" : "hidden",
                  )}
                >
                  {id && canEditDesign && !shellMode ? (
                    <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      <TokensPanel
                        designId={id}
                        onTokensApplied={handleTokensApplied}
                      />
                    </div>
                  ) : (
                    <ReadOnlyEditorPanel
                      title={"Tokens require editor access" /* i18n-ignore */}
                      description={
                        "Ask an owner for edit access before importing, creating, or applying tokens." /* i18n-ignore */
                      }
                    />
                  )}
                </div>
                {SHOW_DESIGN_CODE_LEFT_PANEL ? (
                  <div
                    className={cn(
                      "min-h-0 flex-1 flex-col overflow-hidden",
                      activeLeftPanel === "code" ? "flex" : "hidden",
                    )}
                  >
                    {id && !shellMode && codeWorkbenchOpenedRef.current ? (
                      <CodeWorkbenchLoader
                        designId={id}
                        activeFileId={routeCodeFileId}
                        activeFilename={routeCodeFilename}
                        selectedNodeId={selectedElementLayerId}
                        selectedSelector={selectedCanvasSelector}
                        canEdit={canEditDesign}
                        onDeleteInlineFile={
                          canEditDesign ? handleDeleteInlineFile : undefined
                        }
                        onActiveFileChange={setActiveCodeFile}
                        localhostConnections={workbenchLocalhostConnections}
                        onRequestLocalWriteConsent={
                          handleWorkbenchLocalWriteConsent
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {activeLeftPanel ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("layersPanel.title")}
              className="absolute right-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
              onPointerDown={(event) => startSidebarResize("left", event)}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

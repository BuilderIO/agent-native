import { AgentChatSurface } from "@agent-native/toolkit/app/chat";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { ReaderIcon } from "@radix-ui/react-icons";
import { IconClipboard } from "@tabler/icons-react";
import { memo, type ReactElement } from "react";
import { Link } from "react-router";

import {
  AssetLibraryPanel,
  DesignExtensionsPanel,
} from "@/components/design/DesignExtensionsPanel";
import { LeftPanelHeader } from "@/components/design/editor/LeftPanelHeader";
import { ReadOnlyEditorPanel } from "@/components/design/editor/ReadOnlyEditorPanel";
import { SidebarResizeHandle } from "@/components/design/editor/SidebarResizeHandle";
import { FirstRunStart } from "@/components/design/FirstRunStart";
import { LayersPanel } from "@/components/design/LayersPanel";
import { TokensPanel } from "@/components/design/TokensPanel";
import { DesignComposerContextProvider } from "@/components/editor/DesignComposerContextProvider";
import { FigmaLinkComposerBubble } from "@/components/editor/FigmaLinkComposerBubble";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DESIGN_CHAT_STORAGE_KEY } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorClipboard } from "../domains/use-editor-clipboard";
import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
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
import {
  agentPanelAvailable,
  isLeftPanelTab,
  LEFT_PANEL_TABS,
  type LeftPanelTab,
  showsLeftPanelTabs,
  visibleLeftPanel,
} from "../left-panel-tabs";
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  snapLeftSidebarDragWidth,
} from "../left-sidebar-width";
import {
  type DesignLeftPanel,
  SHOW_DESIGN_SECONDARY_LEFT_PANELS,
} from "../types";

export const INITIAL_GENERATION_DISABLED_LEFT_PANELS = new Set<DesignLeftPanel>(
  ["file", "library"],
);

const leftTabId = (panel: DesignLeftPanel) => `design-left-tab-${panel}`;
const leftPanelId = (panel: DesignLeftPanel) => `design-left-panel-${panel}`;

// The editor re-renders on every selection while the chat stays mounted, so
// its props must stay referentially stable for this memo to hold.
const MemoAgentChatSurface = memo(AgentChatSurface);

export function renderLeftSidebar({
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
  saveStatus,
  minimalUiToggle,
  leftContentWidth,
  leftSidebarVisible,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorSelectionAndStyles: EditorSelectionAndStyles;
  editorClipboard: EditorClipboard;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerModels: EditorLayerModels;
  editorLayerActions: EditorLayerActions;
  editorSourceAndSync: EditorSourceAndSync;
  id: string;
  canApplyPendingVisualEditsWithAgent: boolean;
  projectMenu: ReactElement;
  projectTitleControl: ReactElement;
  saveStatus: ReactElement | null;
  minimalUiToggle: ReactElement | null;
  leftContentWidth: number;
  leftSidebarVisible: boolean;
}) {
  const {
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
    mode,
  } = editorCore;
  const {
    designLeftPanel,
    setActiveLeftPanel,
    collapseLeftPanel,
    leftSidebarContentRef,
    layerPanelExpandedIds,
    setExpandedLayerIds,
    setLeftSidebarWidth,
    startSidebarResize,
  } = editorHistory;
  const activeLeftPanel =
    visibleLeftPanel(
      mode,
      designLeftPanel,
      agentPanelAvailable({
        hostEmbeddedEditor,
        isVisualEditSurface,
        canChatWithAgent: canApplyPendingVisualEditsWithAgent,
      }),
    ) ?? "file";
  const tabsShown = showsLeftPanelTabs(mode);
  const panelProps = (panel: DesignLeftPanel) =>
    tabsShown && isLeftPanelTab(panel)
      ? {
          id: leftPanelId(panel),
          role: "tabpanel",
          "aria-labelledby": leftTabId(panel),
        }
      : { id: leftPanelId(panel) };
  const {
    canEditDesign,
    browserTabId,
    design,
    designDataReady,
    sourceMetadata,
  } = editorGenerationAndAccess;
  const { handleTokensApplied } = editorFilesAndSaving;
  const { handleLayerLeave } = editorCanvasAndScreens;
  const { initialGenerationChromeLimited, resolveAssetScreenPoint } =
    editorLiveEditsAndPresence;
  const {
    hoveredCodeLayerNode,
    handleOpenLibraryComponent,
    libraryComponents,
    libraryComponentsLoading,
    setLibraryComponentsOpen,
  } = editorContentAndComponents;
  const { designExtensionContext } = editorSelectionAndStyles;
  const { handleSidebarScreenSelect } = editorModes;
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
  const { applyingTemplateId, handleFirstRunTemplate } = editorSourceAndSync;

  const showFirstRunStart = designIsEmpty && chatMessageCount === 0;

  const disabledPanels = initialGenerationChromeLimited
    ? INITIAL_GENERATION_DISABLED_LEFT_PANELS
    : undefined;
  const leftPanelTabLabels: Record<LeftPanelTab, string> = {
    agent: t("designEditor.leftTabs.agent"),
    file: t("designEditor.leftTabs.file"),
    library: t("designEditor.leftTabs.library"),
  };
  const whatsNewLabel = t("designEditor.columnHead.whatsNew");

  return (
    <>
      {leftSidebarVisible ? (
        <div
          data-design-chrome-region="left-shell"
          className="absolute inset-y-0 left-0 z-[70] flex min-h-0 bg-[var(--design-editor-panel-bg)]"
        >
          <div
            ref={leftSidebarContentRef}
            data-design-left-column
            className="relative flex min-h-0 max-w-[100dvw] shrink-0 flex-col overflow-hidden bg-[var(--design-editor-panel-bg)] md:max-w-none"
            style={{ width: leftContentWidth }}
          >
            <div
              data-design-chrome-region="left-header"
              className="flex h-[var(--design-column-head-height)] shrink-0 items-center gap-[var(--design-baseline-half)] ps-[var(--design-baseline-unit)] pe-[var(--design-baseline-unit)]"
            >
              {hostEmbeddedEditor ? null : projectMenu}
              <div className="flex min-w-0 flex-1 items-center gap-[var(--design-baseline-half)]">
                <div className="min-w-0 shrink">{projectTitleControl}</div>
                {saveStatus}
              </div>
              {minimalUiToggle}
            </div>
            {tabsShown ? (
              <div
                data-design-left-tabs
                className="flex h-[var(--design-row-height)] shrink-0 items-center px-[calc(var(--design-baseline-unit)*2)]"
              >
                <Tabs
                  value={activeLeftPanel}
                  onValueChange={(value) => {
                    if (!isLeftPanelTab(value)) return;
                    if (disabledPanels?.has(value)) return;
                    setActiveLeftPanel(value);
                  }}
                  className="w-full"
                >
                  <TabsList
                    size="sm"
                    aria-label={t("designEditor.leftTabs.label")}
                    className="grid w-full auto-cols-fr grid-flow-col"
                  >
                    {LEFT_PANEL_TABS.map((panel) => (
                      <TabsTrigger
                        key={panel}
                        value={panel}
                        id={leftTabId(panel)}
                        aria-controls={leftPanelId(panel)}
                        disabled={disabledPanels?.has(panel) ?? false}
                        data-design-left-tab={panel}
                        className="design-focus-ring design-font-medium h-full min-w-0 rounded-[5px] px-2 py-0 text-xs leading-4 focus-visible:ring-0 focus-visible:ring-offset-0"
                      >
                        {leftPanelTabLabels[panel]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            ) : null}
            <div
              {...panelProps("file")}
              className={cn(
                "min-h-0 flex-1 flex-col overflow-hidden",
                activeLeftPanel === "file" ? "flex" : "hidden",
              )}
            >
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
                  components={libraryComponents}
                  componentsLoading={libraryComponentsLoading}
                  onComponentsExpandedChange={setLibraryComponentsOpen}
                  onComponentSelect={(component) =>
                    void handleOpenLibraryComponent({
                      fileId: component.sampleFileId,
                      nodeId: component.sampleNodeId,
                    })
                  }
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
              {...panelProps("agent")}
              data-design-agent-panel
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                activeLeftPanel === "agent" ? "flex" : "hidden",
              )}
            >
              {hostEmbeddedEditor ? (
                <div ref={attachHostChatSlot} className="min-h-0 flex-1" />
              ) : canApplyPendingVisualEditsWithAgent ? (
                <MemoAgentChatSurface
                  composerContextProvider={
                    isSignedIn ? DesignComposerContextProvider : undefined
                  }
                  mode="panel"
                  className="min-h-0 min-w-0 flex-1 border-0 bg-transparent shadow-none"
                  chatOnly={true}
                  onCollapse={collapseLeftPanel}
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
                        knownFiles={
                          designDataReady && design
                            ? shellMode
                              ? design.files
                              : sourceMetadata
                            : undefined
                        }
                        canEditDesign={canEditDesign}
                        applyingTemplateId={applyingTemplateId}
                        onPickTemplate={(templateId) => {
                          void handleFirstRunTemplate(templateId);
                        }}
                      />
                    ) : null
                  }
                  composerSlot={
                    detectedFigmaComposerLink ? (
                      <FigmaLinkComposerBubble
                        link={detectedFigmaComposerLink}
                        designId={id}
                      />
                    ) : null
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
                <LeftPanelHeader title={t("designEditor.leftRail.assets")} />
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
              {...panelProps("library")}
              className={cn(
                "min-h-0 flex-1 flex-col overflow-hidden",
                activeLeftPanel === "library" ? "flex" : "hidden",
              )}
            >
              {id && canEditDesign && !shellMode ? (
                <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {activeLeftPanel === "library" ? (
                    <TokensPanel
                      designId={id}
                      onTokensApplied={handleTokensApplied}
                    />
                  ) : null}
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
              </>
            ) : null}
            {hostEmbeddedEditor ? null : (
              <div
                data-design-left-footer
                className="flex h-[var(--design-section-height)] shrink-0 items-center gap-[var(--design-baseline-half)] px-[var(--design-baseline-unit)]"
              >
                {isSignedIn ? (
                  <OrgSwitcher compact hideBuilderCreditNotice />
                ) : null}
                <div className="flex-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-sm"
                      className="design-focus-ring text-muted-foreground hover:text-foreground"
                    >
                      <Link to="/settings/whats-new" aria-label={whatsNewLabel}>
                        <ReaderIcon
                          className="design-ui-icon"
                          aria-hidden="true"
                        />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{whatsNewLabel}</TooltipContent>
                </Tooltip>
                <FeedbackButton variant="icon" side="top" align="end" />
              </div>
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 end-0 z-[1] w-px bg-[var(--design-editor-panel-divider-color)]"
            />
          </div>
          <SidebarResizeHandle
            edge="end"
            label={t("designEditor.columnHead.resizeLeftPanel")}
            width={leftContentWidth}
            minWidth={LEFT_SIDEBAR_MIN_WIDTH}
            maxWidth={LEFT_SIDEBAR_MAX_WIDTH}
            onPointerDown={(event) => startSidebarResize("left", event)}
            onWidthChange={(width) =>
              setLeftSidebarWidth(snapLeftSidebarDragWidth(width))
            }
            onReset={() => setLeftSidebarWidth(DEFAULT_LEFT_SIDEBAR_WIDTH)}
          />
        </div>
      ) : null}
    </>
  );
}

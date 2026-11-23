import type { ReactElement } from "react";

import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { ReadOnlyEditorPanel } from "@/components/design/editor/ReadOnlyEditorPanel";
import { EditPanel } from "@/components/design/EditPanel";
import { TokensPanel } from "@/components/design/TokensPanel";
import { Button } from "@/components/ui/button";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorHistory } from "../domains/use-editor-history";
import { rightInspectorPanelClassName } from "../minimal-inspector";
import { TOP_BAR_HEIGHT_PX } from "../top-bar";

export function renderRightRail({
  editorCore,
  editorFilesAndSaving,
  id,
  canEditDesign,
  editorHistory,
  editorContentAndComponents,
  projectTitleControl,
  minimalUiToggle,
  localPreviewRow,
  rightSidebarActions,
  topBarVisible,
  interactFloatingBar,
  rightSidebarVisible,
  editPanelProps,
  floatingTweaksPanel,
}: {
  editorCore: EditorCore;
  editorFilesAndSaving: EditorFilesAndSaving;
  id: string;
  canEditDesign: boolean;
  editorHistory: EditorHistory;
  editorContentAndComponents: EditorContentAndComponents;
  projectTitleControl: ReactElement;
  minimalUiToggle: ReactElement | null;
  localPreviewRow: ReactElement | null;
  rightSidebarActions: ReactElement;
  topBarVisible: boolean;
  interactFloatingBar: ReactElement | null;
  rightSidebarVisible: boolean;
  editPanelProps: Omit<
    import("react").ComponentProps<typeof EditPanel>,
    "width"
  >;
  floatingTweaksPanel: ReactElement | null;
}) {
  const { t, mode, hostOwnsChrome, shellMode } = editorCore;
  const {
    activeLeftPanel,
    setActiveLeftPanel,
    rightSidebarContentRef,
    minimalUi,
    rightSidebarWidth,
    startSidebarResize,
  } = editorHistory;
  const { uiHidden } = editorContentAndComponents;

  return (
    <>
      {rightSidebarVisible ? (
        <div
          ref={rightSidebarContentRef}
          data-design-chrome-region="right-panel"
          className={rightInspectorPanelClassName(minimalUi)}
          style={
            topBarVisible && !minimalUi
              ? {
                  width: rightSidebarWidth,
                  top: TOP_BAR_HEIGHT_PX,
                  bottom: 0,
                  height: "auto",
                }
              : { width: rightSidebarWidth }
          }
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("editPanel.properties")}
            className="absolute left-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
            onPointerDown={(event) => startSidebarResize("right", event)}
          />
          {!topBarVisible ? (
            rightSidebarActions
          ) : localPreviewRow ? (
            <div
              data-design-chrome-region="right-toolbar"
              className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-[var(--design-baseline-unit)] py-[var(--design-baseline-half)]"
            >
              {localPreviewRow}
            </div>
          ) : null}
          {mode === "edit" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {!hostOwnsChrome && !minimalUi ? (
                <div data-photoshop-panel-tabs>
                  <Button
                    variant="ghost"
                    aria-pressed={activeLeftPanel !== "tokens"}
                    onClick={() => {
                      if (activeLeftPanel === "tokens")
                        setActiveLeftPanel("file");
                    }}
                  >
                    {t("editPanel.properties")}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={activeLeftPanel === "tokens"}
                    onClick={() => setActiveLeftPanel("tokens")}
                  >
                    {t("designEditor.leftRail.tokens")}
                  </Button>
                </div>
              ) : null}
              {activeLeftPanel === "tokens" && !hostOwnsChrome && !minimalUi ? (
                id && canEditDesign && !shellMode ? (
                  <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    <TokensPanel
                      designId={id}
                      onTokensApplied={editorFilesAndSaving.handleTokensApplied}
                    />
                  </div>
                ) : (
                  <ReadOnlyEditorPanel
                    title={t("designEditor.leftRail.tokens")}
                  />
                )
              ) : (
                <div className="min-h-0 flex-1">
                  <EditPanel {...editPanelProps} width={rightSidebarWidth} />
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1" />
          )}
        </div>
      ) : null}

      {interactFloatingBar && !minimalUi ? (
        <div
          data-design-interact-floating
          className="pointer-events-none absolute inset-x-0 top-0 z-[90] flex justify-center px-3 pt-3"
        >
          {interactFloatingBar}
        </div>
      ) : null}

      {floatingTweaksPanel}

      {minimalUi && !hostOwnsChrome ? (
        <div
          data-design-minimal-ui
          className="pointer-events-none absolute inset-x-0 top-0 z-[90]"
        >
          <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-start gap-3 px-3 pt-3">
            <div
              data-design-minimal-bar="left"
              className="pointer-events-auto flex h-10 min-w-0 max-w-full items-center overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] px-1 shadow-xl"
            >
              <AgentNativeMenuMark className="mx-1 size-5 shrink-0 text-foreground dark:text-white" />
              <div className="min-w-0 flex-1 px-1">{projectTitleControl}</div>
              {minimalUiToggle}
            </div>
            <div
              data-design-minimal-bar="interact"
              className="pointer-events-none flex min-w-0 justify-center"
            >
              {interactFloatingBar}
            </div>
            {!rightSidebarVisible || uiHidden ? (
              <div
                data-design-minimal-bar="right"
                className="pointer-events-auto min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] shadow-xl md:max-w-[680px]"
              >
                {rightSidebarActions}
              </div>
            ) : (
              <div aria-hidden="true" style={{ width: rightSidebarWidth }} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

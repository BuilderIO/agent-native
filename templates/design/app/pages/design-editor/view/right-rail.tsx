import type { ReactElement } from "react";

import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { EditPanel } from "@/components/design/EditPanel";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorModes } from "../domains/use-editor-modes";
import { rightInspectorPanelClassName } from "../minimal-inspector";
import { TOP_BAR_HEIGHT_PX } from "../top-bar";

export function renderRightRail({
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
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorContentAndComponents: EditorContentAndComponents;
  editorModes: EditorModes;
  projectTitleControl: ReactElement;
  minimalUiToggle: ReactElement;
  renderZoomControl: (
    controlId: "toolbar" | "inspector" | "topbar",
  ) => ReactElement;
  localPreviewRow: ReactElement | null;
  rightSidebarActions: ReactElement;
  topBarVisible: boolean;
  renderResponsiveInteractBar: (floating: boolean) => ReactElement;
  rightSidebarVisible: boolean;
  editPanelProps: Omit<
    import("react").ComponentProps<typeof EditPanel>,
    "width"
  >;
}) {
  const { t, mode, hostOwnsChrome, widgetEmbed } = editorCore;
  const {
    rightSidebarContentRef,
    minimalUi,
    rightSidebarWidth,
    startSidebarResize,
  } = editorHistory;
  const { uiHidden } = editorContentAndComponents;
  const { responsiveInteractActive } = editorModes;

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
            <div className="min-h-0 flex-1">
              <EditPanel {...editPanelProps} width={rightSidebarWidth} />
            </div>
          ) : (
            <div className="min-h-0 flex-1" />
          )}
        </div>
      ) : null}

      {minimalUi && !hostOwnsChrome ? (
        <div
          data-design-minimal-ui
          className="pointer-events-none absolute inset-x-0 top-0 z-[90]"
        >
          <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-start gap-3 px-3 pt-3">
            {widgetEmbed ? (
              <div aria-hidden="true" />
            ) : (
              <div
                data-design-minimal-bar="left"
                className="pointer-events-auto flex h-10 min-w-0 max-w-full items-center overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] px-1 shadow-xl"
              >
                <AgentNativeMenuMark className="mx-1 size-5 shrink-0 text-foreground dark:text-white" />
                <div className="min-w-0 flex-1 px-1">{projectTitleControl}</div>
                {minimalUiToggle}
              </div>
            )}
            <div
              data-design-minimal-bar="interact"
              className="pointer-events-none flex min-w-0 justify-center"
            >
              {responsiveInteractActive
                ? renderResponsiveInteractBar(true)
                : null}
            </div>
            {widgetEmbed ? (
              <div aria-hidden="true" />
            ) : !rightSidebarVisible || uiHidden ? (
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

      {/* The widget's only persistent control sits in the bottom corner so it
            never covers the page header the screen starts with. */}
      {widgetEmbed && minimalUi && (!rightSidebarVisible || uiHidden) ? (
        <div
          data-design-widget-zoom
          className="absolute bottom-3 right-3 z-[90] flex h-7 items-center rounded-md border border-border bg-[var(--design-editor-panel-bg)] px-0.5 shadow-md"
        >
          {renderZoomControl("inspector")}
        </div>
      ) : null}
    </>
  );
}

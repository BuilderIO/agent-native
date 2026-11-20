import type { ReactElement } from "react";

import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { SidebarResizeHandle } from "@/components/design/editor/SidebarResizeHandle";
import { EditPanel } from "@/components/design/EditPanel";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import {
  DEFAULT_INSPECTOR_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  snapInspectorDragWidth,
} from "../inspector-width";
import { rightInspectorPanelClassName } from "../minimal-inspector";

export function renderRightRail({
  editorCore,
  editorHistory,
  editorContentAndComponents,
  projectTitleControl,
  minimalUiToggle,
  rightSidebarActions,
  interactFloatingBar,
  rightSidebarVisible,
  floatingHeadAllowed,
  commentsPanel,
  editPanelProps,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorContentAndComponents: EditorContentAndComponents;
  projectTitleControl: ReactElement;
  minimalUiToggle: ReactElement | null;
  /** The right column head; it also floats as an island where the column is absent. */
  rightSidebarActions: ReactElement;
  interactFloatingBar: ReactElement | null;
  rightSidebarVisible: boolean;
  /** Whether the head may float while the column is absent (not during first generation). */
  floatingHeadAllowed: boolean;
  /** Shown in place of the inspector while Comments is open. */
  commentsPanel: ReactElement | null;
  editPanelProps: Omit<
    import("react").ComponentProps<typeof EditPanel>,
    "width"
  >;
}) {
  const { t, mode, hostOwnsChrome } = editorCore;
  const {
    rightSidebarContentRef,
    minimalUi,
    rightSidebarWidth,
    setRightSidebarWidth,
    startSidebarResize,
    commentsPanelOpen,
  } = editorHistory;
  const { uiHidden } = editorContentAndComponents;
  const showComments = commentsPanelOpen && commentsPanel !== null;
  // Interact has no inspector, but its head (Share, presence) must stay
  // reachable, so it floats top right like minimal UI's island.
  const floatingHeadVisible =
    floatingHeadAllowed &&
    !minimalUi &&
    !rightSidebarVisible &&
    !hostOwnsChrome &&
    !uiHidden;

  return (
    <>
      {rightSidebarVisible ? (
        <div
          ref={rightSidebarContentRef}
          data-design-chrome-region="right-panel"
          className={rightInspectorPanelClassName(minimalUi)}
          style={{ width: rightSidebarWidth }}
        >
          {minimalUi ? null : (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-0 z-[1] w-px bg-[var(--design-editor-panel-divider-color)]"
            />
          )}
          <SidebarResizeHandle
            edge="start"
            label={t("designEditor.columnHead.resizeInspector")}
            width={rightSidebarWidth}
            minWidth={INSPECTOR_MIN_WIDTH}
            maxWidth={INSPECTOR_MAX_WIDTH}
            onPointerDown={(event) => startSidebarResize("right", event)}
            onWidthChange={(width) =>
              setRightSidebarWidth(snapInspectorDragWidth(width))
            }
            onReset={() => setRightSidebarWidth(DEFAULT_INSPECTOR_WIDTH)}
          />
          {rightSidebarActions}
          {showComments ? (
            <div
              data-design-comments-panel
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {commentsPanel}
            </div>
          ) : mode === "edit" ? (
            <div className="min-h-0 flex-1">
              <EditPanel {...editPanelProps} width={rightSidebarWidth} />
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

      {floatingHeadVisible ? (
        <div
          data-design-floating-right-head
          className="pointer-events-auto absolute right-3 top-3 z-[90] min-w-0 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] shadow-xl md:max-w-[680px]"
        >
          {rightSidebarActions}
        </div>
      ) : null}

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

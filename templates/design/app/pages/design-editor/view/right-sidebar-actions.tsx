import type { ReactElement } from "react";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";

export function renderRightSidebarActions({
  editorCore,
  editorHistory,
  renderZoomControl,
  renderPendingNodeRewriteControl,
  publishWaitlistControl,
  presenceControl,
  reviewFeedbackControl,
  renderShareControl,
  localPreviewRow,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  renderZoomControl: (
    controlId: "toolbar" | "inspector" | "topbar",
  ) => ReactElement;
  renderPendingNodeRewriteControl: (compact: boolean) => ReactElement | null;
  publishWaitlistControl: ReactElement | null;
  presenceControl: ReactElement | null;
  reviewFeedbackControl: ReactElement | null;
  renderShareControl: (dense: boolean) => ReactElement | null;
  localPreviewRow: ReactElement | null;
}) {
  const { hostEmbeddedEditor, sessionResolved, isSignedIn } = editorCore;
  const { rightSidebarWidth } = editorHistory;

  const rightToolbarCompact = rightSidebarWidth < 320;

  return (
    <div
      data-design-chrome-region="right-toolbar"
      className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-[var(--design-baseline-unit)] py-[var(--design-baseline-half)]"
    >
      {/* Presence leads the row and the zoom sits under it. When nothing
          leads (no presence, no waitlist CTA) the leading cluster renders
          empty and drops out of the grid, so the zoom joins the Share row,
          next to Share: the floating title pill covers the panel's top-left
          corner in a narrow frame. */}
      <div
        data-design-chrome-region="right-toolbar-actions"
        className="group/actions grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[var(--design-baseline-half)] gap-y-[var(--design-baseline-half)]"
      >
        <div
          data-design-right-toolbar-leading
          className="col-start-1 flex min-h-[var(--design-row-height)] min-w-0 items-center gap-[var(--design-baseline-half)] empty:hidden"
        >
          {hostEmbeddedEditor ? null : (
            <>
              {presenceControl}
              {sessionResolved && !isSignedIn ? publishWaitlistControl : null}
            </>
          )}
        </div>

        {/* Not shrink-0: the signed-out CTA ("Sign up") is a
            nowrap label wide enough to push this row past the right rail's
            edge on its own, and a shrink-0 row has no way to give that space
            back — it just overflows the panel. */}
        <div className="col-start-2 row-start-1 flex min-h-[var(--design-row-height)] min-w-0 shrink items-center gap-[var(--design-baseline-half)]">
          {renderPendingNodeRewriteControl(rightToolbarCompact)}
          {reviewFeedbackControl}
          {!sessionResolved || isSignedIn ? publishWaitlistControl : null}
          {renderShareControl(false)}
        </div>

        {localPreviewRow ? (
          <div className="col-span-full min-w-0">{localPreviewRow}</div>
        ) : null}

        <div
          data-design-right-toolbar-zoom
          className="col-start-1 flex h-[var(--design-row-height)] min-w-0 flex-nowrap items-center justify-self-start group-has-[[data-design-right-toolbar-leading]:empty]/actions:row-start-1 group-has-[[data-design-right-toolbar-leading]:empty]/actions:justify-self-end"
        >
          <div className="shrink-0">{renderZoomControl("inspector")}</div>
        </div>
      </div>
    </div>
  );
}

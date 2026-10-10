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
      <div
        data-design-chrome-region="right-toolbar-actions"
        className="flex min-h-[var(--design-row-height)] items-center gap-[var(--design-baseline-half)]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-[var(--design-baseline-half)]">
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
        <div className="flex min-w-0 shrink items-center gap-[var(--design-baseline-half)]">
          {renderPendingNodeRewriteControl(rightToolbarCompact)}
          {reviewFeedbackControl}
          {!sessionResolved || isSignedIn ? publishWaitlistControl : null}
          {renderShareControl(false)}
        </div>
      </div>
      {localPreviewRow ? (
        <div className="mt-[var(--design-baseline-half)]">
          {localPreviewRow}
        </div>
      ) : null}
      <div className="mt-[var(--design-baseline-half)] flex h-[var(--design-row-height)] min-w-0 flex-nowrap items-center gap-[var(--design-baseline-half)]">
        <div className="shrink-0">{renderZoomControl("inspector")}</div>
      </div>
    </div>
  );
}

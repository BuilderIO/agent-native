import { ChatBubbleIcon } from "@radix-ui/react-icons";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";

/**
 * The right column head: Comments (and Apply feedback when there is any) at
 * its start, presence, publish and Share at its end. Minimal UI floats the same
 * row as an island when nothing is selected.
 */
export function renderRightSidebarActions({
  editorCore,
  editorHistory,
  renderPendingNodeRewriteControl,
  publishWaitlistControl,
  presenceControl,
  reviewFeedbackControl,
  renderShareControl,
  localPreviewRow,
  showCommentsToggle,
  reviewUnreadCount,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  renderPendingNodeRewriteControl: (compact: boolean) => ReactElement | null;
  publishWaitlistControl: ReactElement | null;
  presenceControl: ReactElement | null;
  reviewFeedbackControl: ReactElement | null;
  renderShareControl: (dense: boolean) => ReactElement | null;
  localPreviewRow: ReactElement | null;
  showCommentsToggle: boolean;
  reviewUnreadCount: number;
}) {
  const { t, hostEmbeddedEditor, sessionResolved, isSignedIn } = editorCore;
  const { rightSidebarWidth, commentsPanelOpen, setCommentsPanelOpen } =
    editorHistory;

  const rightToolbarCompact = rightSidebarWidth < 320;
  const hasUnreadComments = reviewUnreadCount > 0;

  return (
    <div
      data-design-chrome-region="right-toolbar"
      className="shrink-0 bg-[var(--design-editor-panel-bg)]"
    >
      <div
        data-design-chrome-region="right-toolbar-actions"
        className="flex h-[var(--design-column-head-height)] min-w-0 items-center gap-[var(--design-baseline-half)] ps-[var(--design-inspector-section-padding-inline)] pe-[calc(var(--design-baseline-unit)*2)]"
      >
        {showCommentsToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-design-comments-toggle
            aria-pressed={commentsPanelOpen}
            onClick={() => setCommentsPanelOpen((open) => !open)}
            className={cn(
              "design-focus-ring design-font-medium relative h-[var(--design-control-height)] shrink-0 gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-xs",
              commentsPanelOpen &&
                "bg-[var(--design-editor-active-row-color)] text-[var(--design-brand-ink)]",
            )}
          >
            <ChatBubbleIcon className="design-ui-icon" aria-hidden="true" />
            {t("designEditor.columnHead.comments")}
            {hasUnreadComments ? (
              <>
                <span
                  aria-hidden="true"
                  data-design-comments-unread-dot
                  className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-[var(--design-brand)]"
                />
                <span className="sr-only">
                  {t("designEditor.columnHead.unreadComments")}
                </span>
              </>
            ) : null}
          </Button>
        ) : null}
        {reviewFeedbackControl}

        <div className="min-w-0 flex-1" />

        {/* Not shrink-0: the signed-out CTA ("Sign up") is a nowrap label
            wide enough to push this row past the column's edge on its own. */}
        <div className="flex min-w-0 shrink items-center gap-[var(--design-baseline-half)]">
          {renderPendingNodeRewriteControl(rightToolbarCompact)}
          {hostEmbeddedEditor ? null : presenceControl}
          {!hostEmbeddedEditor || !sessionResolved || isSignedIn
            ? publishWaitlistControl
            : null}
          {renderShareControl(true)}
        </div>
      </div>

      {localPreviewRow ? (
        <div className="min-w-0 px-[var(--design-inspector-section-padding-inline)] pb-[var(--design-baseline-half)]">
          {localPreviewRow}
        </div>
      ) : null}
    </div>
  );
}

import { ChatBubbleIcon } from "@radix-ui/react-icons";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";

export function renderRightSidebarActions({
  editorCore,
  editorHistory,
  renderPendingNodeRewriteControl,
  publishWaitlistControl,
  presenceControl,
  renderReviewFeedbackControl,
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
  renderReviewFeedbackControl: (compact: boolean) => ReactElement | null;
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
  const reviewFeedbackControl = renderReviewFeedbackControl(
    rightSidebarWidth < 360,
  );
  const commentsLabelVisible =
    rightSidebarWidth >= 280 && reviewFeedbackControl === null;
  const commentsLabel = t("designEditor.columnHead.comments");
  const unreadCommentsLabel = t("designEditor.columnHead.unreadComments");
  const commentsAccessibleName = hasUnreadComments
    ? `${commentsLabel}, ${unreadCommentsLabel}`
    : commentsLabel;

  const commentsToggle = showCommentsToggle ? (
    <Button
      type="button"
      variant="ghost"
      size={commentsLabelVisible ? "xs" : "icon-xs"}
      data-design-comments-toggle
      aria-pressed={commentsPanelOpen}
      aria-label={commentsLabelVisible ? undefined : commentsAccessibleName}
      onClick={() => setCommentsPanelOpen((open) => !open)}
      className={cn(
        "design-focus-ring design-font-medium relative min-w-0 gap-[var(--design-baseline-half)] [&_svg]:size-[var(--design-icon-size)]",
        commentsLabelVisible ? "shrink" : "shrink-0",
        commentsPanelOpen &&
          "bg-[var(--design-editor-active-row-color)] text-[var(--design-brand-ink)]",
      )}
    >
      <ChatBubbleIcon className="design-ui-icon shrink-0" aria-hidden="true" />
      {commentsLabelVisible ? (
        <span className="min-w-0 truncate">{commentsLabel}</span>
      ) : null}
      {hasUnreadComments ? (
        <>
          <span
            aria-hidden="true"
            data-design-comments-unread-dot
            className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-[var(--design-brand)]"
          />
          <span className="sr-only">{unreadCommentsLabel}</span>
        </>
      ) : null}
    </Button>
  ) : null;

  return (
    <div
      data-design-chrome-region="right-toolbar"
      className="shrink-0 bg-[var(--design-editor-panel-bg)]"
    >
      <div
        data-design-chrome-region="right-toolbar-actions"
        className="flex h-[var(--design-column-head-height)] min-w-0 items-center gap-[var(--design-baseline-half)] ps-[var(--design-baseline-unit)] pe-[calc(var(--design-baseline-unit)*2)]"
      >
        {commentsToggle && !commentsLabelVisible ? (
          <Tooltip>
            <TooltipTrigger asChild>{commentsToggle}</TooltipTrigger>
            <TooltipContent>{commentsLabel}</TooltipContent>
          </Tooltip>
        ) : (
          commentsToggle
        )}
        {reviewFeedbackControl}

        <div className="ms-auto flex min-w-0 shrink items-center gap-[var(--design-baseline-half)]">
          {renderPendingNodeRewriteControl(rightToolbarCompact)}
          {hostEmbeddedEditor ? null : presenceControl}
          {!hostEmbeddedEditor || !sessionResolved || isSignedIn
            ? publishWaitlistControl
            : null}
          {renderShareControl(true)}
        </div>
      </div>

      {localPreviewRow ? (
        <div className="min-w-0 px-[var(--design-baseline-unit)] pb-[var(--design-baseline-half)]">
          {localPreviewRow}
        </div>
      ) : null}
    </div>
  );
}

import { useT } from "@agent-native/core/client/i18n";
import {
  ReviewThreadPanel,
  type ReviewThread,
} from "@agent-native/core/client/review";
import type { ReviewComment } from "@agent-native/core/review";
import { IconSend } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ReviewCommentsPanelProps {
  designId: string;
  canComment: boolean;
  /** Caller-derived editor capability for resolving threads. */
  canResolve?: boolean;
  /** Caller authorization for deleting a specific root comment. */
  canDeleteComment?: (comment: ReviewComment, thread: ReviewThread) => boolean;
  signInHref?: string;
  onSelectThread?: (thread: ReviewThread) => void;
  canDispatchToAgent?: boolean;
  sendingThreadId?: string | null;
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  className?: string;
}

export function ReviewCommentsPanel({
  designId,
  canComment,
  canResolve,
  canDeleteComment,
  signInHref,
  onSelectThread,
  canDispatchToAgent = false,
  sendingThreadId,
  onSendThreadToAgent,
  className,
}: ReviewCommentsPanelProps) {
  const t = useT();

  return (
    <div
      data-review-comments-panel
      className={cn(
        "design-sidebar-comments flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      {!canComment && signInHref ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mx-2 mt-2 min-h-[var(--design-row-height)] shrink-0"
        >
          <a href={signInHref}>{t("review.signInToComment")}</a>
        </Button>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewThreadPanel
          resourceType="design"
          resourceId={designId}
          title={t("review.panelTitle")}
          emptyState={t("review.emptyState")}
          loadingLabel={t("review.loading")}
          replyLabel={t("review.reply")}
          replyPlaceholder={t("review.replyPlaceholder")}
          cancelReplyLabel={t("review.cancelReply")}
          resolveLabel={t("review.resolve")}
          deleteLabel={t("review.deleteComment")}
          moreActionsLabel={t("review.moreActions")}
          resolvedLabel={t("review.resolved")}
          reviewerLabel={t("review.reviewer")}
          includeResolved
          showHeader={false}
          variant="plain"
          className="design-sidebar-comments"
          showComposer={false}
          canReply={canComment}
          canResolve={canResolve ?? false}
          canDeleteComment={canDeleteComment}
          showComposerTargetPicker={false}
          onSelectThread={onSelectThread}
          renderThreadActions={
            canDispatchToAgent && onSendThreadToAgent
              ? (thread) => {
                  if (thread.root.status !== "open") return null;
                  const alreadyQueued =
                    thread.root.resolutionTarget !== "human" &&
                    !thread.root.consumedAt;
                  if (alreadyQueued) return null;
                  const sending = sendingThreadId === thread.root.threadId;
                  const dispatchPending = Boolean(sendingThreadId);
                  return (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="design-sidebar-control-text h-7 gap-1.5 px-2"
                      disabled={dispatchPending}
                      aria-busy={sending}
                      aria-label={t("review.sendToAgent")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSendThreadToAgent(thread);
                      }}
                    >
                      {sending ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <IconSend className="size-3.5" />
                      )}
                      <span className="hidden @xs/review:inline">
                        {sending
                          ? t("review.sendingToAgent")
                          : t("review.sendToAgent")}
                      </span>
                    </Button>
                  );
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

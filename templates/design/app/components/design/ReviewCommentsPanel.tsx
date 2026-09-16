import { useT } from "@agent-native/core/client/i18n";
import {
  useResolveReviewThread,
  useSetReviewThreadUnread,
  ReviewThreadPanel,
  type ReviewThread,
} from "@agent-native/core/client/review";
import type { ReviewComment } from "@agent-native/core/review";
import { IconFilter, IconSend } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  currentTargetId?: string | null;
  currentUserEmail?: string | null;
  className?: string;
}

type ReviewFilter = "all" | "resolved" | "yours" | "current";

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
  currentTargetId = null,
  currentUserEmail = null,
  className,
}: ReviewCommentsPanelProps) {
  const t = useT();
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const resolveThread = useResolveReviewThread();
  const markUnread = useSetReviewThreadUnread();
  const threadFilter = useMemo(
    () => (thread: ReviewThread) => {
      if (filter === "resolved") return thread.root.status === "resolved";
      if (filter === "current") {
        return (
          Boolean(currentTargetId) && thread.root.targetId === currentTargetId
        );
      }
      if (filter === "yours") {
        const email = currentUserEmail?.trim().toLowerCase();
        if (!email) return false;
        return [thread.root, ...thread.replies].some(
          (comment) => comment.authorEmail?.toLowerCase() === email,
        );
      }
      return true;
    },
    [currentTargetId, currentUserEmail, filter],
  );
  const filterLabel =
    filter === "resolved"
      ? t("review.resolved")
      : filter === "yours"
        ? t("review.yours")
        : filter === "current"
          ? t("review.thisScreen")
          : t("review.allScreens");
  const copyThreadLink = async (thread: ReviewThread) => {
    const url = new URL(window.location.href);
    url.searchParams.set("comment", thread.root.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(t("review.linkCopied"));
    } catch {
      toast.error(t("review.copyLinkFailed"));
    }
  };
  const markThreadUnread = (thread: ReviewThread) => {
    markUnread.mutate(
      {
        resourceType: "design",
        resourceId: designId,
        threadId: thread.root.threadId,
        unread: true,
      },
      {
        onSuccess: () => toast.success(t("review.markedUnread")),
        onError: () => toast.error(t("review.markUnreadFailed")),
      },
    );
  };
  const onThreadResolved = (thread: ReviewThread) => {
    toast.success(t("review.resolved"), {
      action: {
        label: t("review.undo"),
        onClick: () =>
          resolveThread.mutate({
            resourceType: "design",
            resourceId: designId,
            threadId: thread.root.threadId,
            status: "open",
          }),
      },
    });
  };

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

      <div className="flex items-center justify-end border-b border-border px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              aria-label={t("review.filter")}
            >
              <IconFilter className="size-3.5" />
              {filterLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => setFilter(value as ReviewFilter)}
            >
              <DropdownMenuRadioItem value="all">
                {t("review.allScreens")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="current"
                disabled={!currentTargetId}
              >
                {t("review.thisScreen")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="yours" disabled={!currentUserEmail}>
                {t("review.yours")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="resolved">
                {t("review.resolved")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewThreadPanel
          resourceType="design"
          resourceId={designId}
          newestFirst
          title={t("review.panelTitle")}
          emptyState={t("review.emptyState")}
          loadingLabel={t("review.loading")}
          replyLabel={t("review.reply")}
          replyPlaceholder={t("review.replyPlaceholder")}
          cancelReplyLabel={t("review.cancelReply")}
          resolveLabel={t("review.resolve")}
          deleteLabel={t("review.deleteComment")}
          moreActionsLabel={t("review.moreActions")}
          copyLinkLabel={t("review.copyLink")}
          markUnreadLabel={t("review.markUnread")}
          addReactionLabel={t("review.addReaction")}
          reopenLabel={t("review.reopen")}
          reopeningLabel={t("review.reopening")}
          confirmDeleteTitle={t("review.confirmDeleteTitle")}
          confirmDeleteDescription={t("review.confirmDeleteDescription")}
          confirmDeleteLabel={t("review.deleteComment")}
          cancelDeleteLabel={t("review.cancelDelete")}
          resolvedLabel={t("review.resolved")}
          reviewerLabel={t("review.reviewer")}
          threadFilter={threadFilter}
          onReactionError={() => toast.error(t("review.reactionFailed"))}
          onCopyThreadLink={(thread) => void copyThreadLink(thread)}
          onMarkThreadUnread={markThreadUnread}
          showReactions
          onThreadResolved={onThreadResolved}
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

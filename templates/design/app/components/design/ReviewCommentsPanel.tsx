import {
  ReviewThreadPanel,
  type ReviewThread,
  useT,
} from "@agent-native/core/client";
import type { ReviewComment } from "@agent-native/core/review";
import { IconSend } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface ReviewCommentsPanelProps {
  designId: string;
  activeFileId?: string | null;
  commentAnchor?: unknown | null;
  commentMetadata?: Record<string, unknown>;
  commentContextLabel?: string;
  canComment: boolean;
  /** Caller-derived editor capability for resolving threads. */
  canResolve?: boolean;
  /** Caller authorization for deleting a specific root comment. */
  canDeleteComment?: (comment: ReviewComment, thread: ReviewThread) => boolean;
  showComposer?: boolean;
  signInHref?: string;
  onSelectThread?: (thread: ReviewThread) => void;
  canDispatchToAgent?: boolean;
  sendingThreadId?: string | null;
  onDispatchCommentToAgent?: (comment: ReviewComment) => void;
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  className?: string;
}

type ReviewCommentsScope = "screen" | "all";

export function resolveReviewComposerTargetId({
  scope,
  activeFileId,
  commentAnchor,
}: {
  scope: ReviewCommentsScope;
  activeFileId?: string | null;
  commentAnchor?: unknown | null;
}): string | null | undefined {
  if (commentAnchor != null) return activeFileId;
  return scope === "screen" ? activeFileId : undefined;
}

export function ReviewCommentsPanel({
  designId,
  activeFileId,
  commentAnchor,
  commentMetadata,
  commentContextLabel,
  canComment,
  canResolve,
  canDeleteComment,
  showComposer = true,
  signInHref,
  onSelectThread,
  canDispatchToAgent = false,
  sendingThreadId,
  onDispatchCommentToAgent,
  onSendThreadToAgent,
  className,
}: ReviewCommentsPanelProps) {
  const t = useT();
  const [scope, setScope] = useState<ReviewCommentsScope>("screen");
  const targetId = scope === "screen" ? activeFileId : undefined;
  const composerTargetId = resolveReviewComposerTargetId({
    scope,
    activeFileId,
    commentAnchor,
  });

  return (
    <div
      data-review-comments-panel
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <div className="shrink-0 border-b border-border px-3 py-2">
        <Tabs
          value={scope}
          onValueChange={(value) => setScope(value as "screen" | "all")}
          className="w-full"
        >
          <TabsList className="grid h-8 w-full grid-cols-2 rounded-md bg-muted p-0.5">
            <TabsTrigger value="screen" className="h-7 px-2 text-xs">
              {t("review.thisScreen")}
            </TabsTrigger>
            <TabsTrigger value="all" className="h-7 px-2 text-xs">
              {t("review.allScreens")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {!canComment && signInHref ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mx-3 mt-3 h-8 shrink-0"
        >
          <a href={signInHref}>{t("review.signInToComment")}</a>
        </Button>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewThreadPanel
          resourceType="design"
          resourceId={designId}
          targetId={targetId}
          composerTargetId={composerTargetId}
          composerAnchor={commentAnchor}
          composerMetadata={commentMetadata}
          composerContextLabel={commentContextLabel}
          title={t("review.panelTitle")}
          placeholder={t("review.placeholder")}
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
          showComposer={canComment && showComposer}
          canReply={canComment}
          canResolve={canResolve ?? false}
          canDeleteComment={canDeleteComment}
          showComposerTargetPicker={
            canComment && showComposer && canDispatchToAgent
          }
          composerCommentLabel={t("review.commentMode")}
          composerAgentLabel={t("review.sendToAgent")}
          onCommentCreated={(comment) => {
            if (canDispatchToAgent && comment.resolutionTarget === "agent") {
              onDispatchCommentToAgent?.(comment);
            }
          }}
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
                      className="h-7 gap-1.5 px-2 text-xs"
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

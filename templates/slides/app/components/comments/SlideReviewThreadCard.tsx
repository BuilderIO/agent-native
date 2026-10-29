import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useDeleteReviewComment,
  useReactToReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useUpdateReviewComment,
} from "@agent-native/core/client/review";
import type {
  ReviewComment,
  ReviewDiscussionState,
  ReviewMention,
} from "@agent-native/core/review";
import {
  ReviewAuthorAvatar,
  ReviewCommentComposer,
  ReviewCommentItem,
  ReviewThreadCardFrame,
  ReviewThreadMenu,
  type ReviewMentionOption,
} from "@agent-native/toolkit/app/review";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  SLIDE_REVIEW_RESOURCE_TYPE,
  SLIDE_REVIEW_THREAD_PARAM,
} from "@shared/slide-review";
import { forwardRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CommentThread } from "@/hooks/use-slide-comments";
import type { SlideReviewAgentController } from "@/hooks/use-slide-review-agent";
import { cn } from "@/lib/utils";

import { buildSlideReviewAgentContext } from "./slide-review-agent-context";
import { SlideReviewAgentStatus } from "./SlideReviewAgentStatus";

export interface SlideReviewThreadCardProps {
  thread: CommentThread;
  deckId: string;
  discussion: ReviewDiscussionState | undefined;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string | null;
  peopleMentionOptions: readonly ReviewMention[];
  agent: SlideReviewAgentController;
  onBeforeCommentSubmit?: (() => Promise<void>) | undefined;
  onClose?: (() => void) | undefined;
  onResolved?: ((threadId: string) => void) | undefined;
  className?: string | undefined;
}

function sameEmail(left: string | null | undefined, right: string | null) {
  return Boolean(
    left && right && left.trim().toLowerCase() === right.trim().toLowerCase(),
  );
}

export function slideReviewThreadLink(threadId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(SLIDE_REVIEW_THREAD_PARAM, threadId);
  url.searchParams.delete("slide");
  return url.toString();
}

export const SlideReviewThreadCard = forwardRef<
  HTMLDivElement,
  SlideReviewThreadCardProps
>(function SlideReviewThreadCard(
  {
    thread,
    deckId,
    discussion,
    canComment,
    canEdit,
    currentUserEmail,
    peopleMentionOptions,
    agent,
    onBeforeCommentSubmit,
    onClose,
    onResolved,
    className,
  },
  ref,
) {
  const t = useT();
  const reply = useReplyReviewComment();
  const resolve = useResolveReviewThread();
  const update = useUpdateReviewComment();
  const remove = useDeleteReviewComment();
  const react = useReactToReviewComment();
  const [replyDraft, setReplyDraft] = useState("");
  const [replyMentions, setReplyMentions] = useState<ReviewMention[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editMentions, setEditMentions] = useState<ReviewMention[]>([]);
  const [deleting, setDeleting] = useState<ReviewComment | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const { root, replies } = thread.review;
  const resolved = thread.resolved;
  const resource = {
    resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
    resourceId: deckId,
  };
  const mentionOptions: readonly ReviewMentionOption[] = canEdit
    ? [...peopleMentionOptions, ...agent.mentionOptions]
    : peopleMentionOptions;
  const agentRequest = agent.requestForThread(thread.threadId);

  const submitReply = async () => {
    const body = replyDraft.trim();
    if (!body || reply.isPending) return;
    const mentions = replyMentions;
    try {
      await onBeforeCommentSubmit?.();
      const created = await reply.mutateAsync({
        ...resource,
        commentId: root.id,
        body,
        mentions,
        clientOperationId: crypto.randomUUID(),
      });
      setReplyDraft("");
      setReplyMentions([]);
      const outcome = await agent.startIfTagged({
        threadId: thread.threadId,
        commentId: created.id,
        mentions,
      });
      reportAgentOutcome(outcome);
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("comments.saveReplyFailed"));
    }
  };

  const reportAgentOutcome = (outcome: string | null) => {
    if (outcome === "busy") toast.error(t("comments.agentBusy"));
    else if (outcome === "setup-required")
      toast.error(t("comments.agentSetupRequired"));
    else if (outcome === "failed") toast.error(t("comments.agentStartFailed"));
  };

  const toggleResolved = () => {
    resolve.mutate(
      {
        ...resource,
        threadId: thread.threadId,
        status: resolved ? "open" : "resolved",
      },
      {
        onSuccess: () => {
          if (!resolved) onResolved?.(thread.threadId);
        },
        onError: (error) =>
          toast.error(actionErrorMessage(error) ?? t("comments.updateFailed")),
      },
    );
  };

  const startEdit = (comment: ReviewComment) => {
    setEditingId(comment.id);
    setEditDraft(comment.body);
    setEditMentions(comment.mentions);
  };

  const submitEdit = () => {
    const body = editDraft.trim();
    if (!editingId || !body) return;
    update.mutate(
      { ...resource, commentId: editingId, body, mentions: editMentions },
      {
        onSuccess: () => setEditingId(null),
        onError: (error) =>
          toast.error(actionErrorMessage(error) ?? t("comments.updateFailed")),
      },
    );
  };

  const confirmDelete = () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    remove.mutate(
      { ...resource, commentId: target.id },
      {
        onError: (error) =>
          toast.error(actionErrorMessage(error) ?? t("comments.deleteFailed")),
      },
    );
  };

  const copyLink = async () => {
    try {
      await writeClipboardText(slideReviewThreadLink(thread.threadId));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1_500);
  };

  const sendToAgent = () => {
    sendToAgentChat({
      // The chat drops an empty message; the composer trims this one.
      message: " ",
      context: buildSlideReviewAgentContext({ deckId, thread }),
      submit: false,
    });
  };

  const commentItem = (comment: ReviewComment, variant: "root" | "reply") => (
    <ReviewCommentItem
      key={comment.id}
      comment={comment}
      variant={variant}
      reviewerLabel={t("comments.reviewer")}
      agentBadgeLabel={t("comments.agentBadge")}
      resolvedLabel={t("comments.resolved")}
      unreadLabel={t("comments.unread")}
      addReactionLabel={t("comments.addReaction")}
      reactionLabel={({ emoji, count, includesYou }) =>
        t(includesYou ? "comments.reactionMine" : "comments.reactionLabel", {
          emoji,
          count,
        })
      }
      showReactions
      reactions={discussion?.reactions[comment.id] ?? []}
      canReact={Boolean(discussion?.canReact) && canComment}
      onReact={(target, reaction, active) =>
        react.mutate(
          { ...resource, commentId: target.id, reaction, active },
          {
            onError: (error) =>
              toast.error(
                actionErrorMessage(error) ?? t("comments.reactionFailed"),
              ),
          },
        )
      }
      editor={
        editingId === comment.id ? (
          <ReviewCommentComposer
            value={editDraft}
            mentions={editMentions}
            onMentionsChange={setEditMentions}
            mentionOptions={peopleMentionOptions}
            showCommentTools
            emojiLabel={t("comments.addEmoji")}
            mentionLabel={t("comments.mention")}
            noMentionsLabel={t("comments.noMentions")}
            textareaProps={{ "aria-label": t("comments.editComment") }}
            autoFocus
            disabled={update.isPending}
            onChange={setEditDraft}
            onSubmit={submitEdit}
            commentLabel={t("comments.save")}
            placeholder={t("comments.editComment")}
            submitOnEnter
            onEscape={() => setEditingId(null)}
          />
        ) : undefined
      }
    />
  );

  const ownRoot = sameEmail(root.authorEmail, currentUserEmail);

  return (
    <>
      <ReviewThreadCardFrame
        ref={ref}
        className={className}
        title={t("comments.threadTitle")}
        menu={
          <ReviewThreadMenu
            moreActionsLabel={t("comments.moreActions")}
            sendToAgentLabel={t("comments.sendToAgent")}
            copyLinkLabel={t("comments.copyLink")}
            linkCopiedLabel={t("comments.linkCopied")}
            copyLinkFailedLabel={t("comments.copyLinkFailed")}
            editLabel={t("comments.editComment")}
            deleteLabel={t("comments.deleteComment")}
            onSendToAgent={canEdit && !resolved ? sendToAgent : undefined}
            canEdit={ownRoot && canComment}
            onEdit={() => startEdit(root)}
            onCopyLink={() => void copyLink()}
            copyLinkState={copyState}
            onDelete={root.canDelete ? () => setDeleting(root) : undefined}
          />
        }
        resolved={resolved}
        onResolve={canEdit ? toggleResolved : undefined}
        onReopen={canEdit ? toggleResolved : undefined}
        resolving={resolve.isPending}
        resolveLabel={t("comments.resolveThread")}
        reopenLabel={t("comments.reopenThread")}
        onClose={onClose}
        closeLabel={t("comments.closeThread")}
      >
        {thread.quotedText ? (
          <blockquote className="mx-3 mt-3 line-clamp-3 border-s-2 border-primary/50 ps-2 text-xs text-muted-foreground">
            {thread.quotedText}
          </blockquote>
        ) : null}
        <div className={cn("flex flex-col", !canComment && "pb-3")}>
          {commentItem(root, "root")}
          {replies.map((comment) => commentItem(comment, "reply"))}
        </div>
        <SlideReviewAgentStatus
          request={agentRequest}
          starting={agent.isStarting(thread.threadId)}
          stopping={
            agentRequest ? agent.isStopping(agentRequest.requestId) : false
          }
          onStop={(request) => void agent.stop(request)}
          onOpen={agent.open}
        />
        {canComment && !resolved ? (
          <div className="group/reply flex items-start gap-2 px-3 py-4">
            <div className="mt-2 shrink-0 group-has-data-expanded/reply:mt-0.5">
              <ReviewAuthorAvatar
                name={currentUserEmail ?? t("comments.reviewer")}
                email={currentUserEmail}
                size={24}
              />
            </div>
            <ReviewCommentComposer
              className="min-w-0 flex-1"
              variant="reply"
              value={replyDraft}
              mentions={replyMentions}
              onMentionsChange={setReplyMentions}
              mentionOptions={mentionOptions}
              agentsLabel={t("comments.agentsSection")}
              showCommentTools
              emojiLabel={t("comments.addEmoji")}
              mentionLabel={t("comments.mention")}
              noMentionsLabel={t("comments.noMentions")}
              textareaProps={{ "data-slide-review-reply-input": true }}
              disabled={reply.isPending}
              onChange={setReplyDraft}
              onSubmit={() => void submitReply()}
              submittingTarget={reply.isPending ? "human" : null}
              commentLabel={t("comments.reply")}
              placeholder={t("comments.replyPlaceholder")}
              submitOnEnter
              onEscape={onClose}
            />
          </div>
        ) : null}
      </ReviewThreadCardFrame>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("comments.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("comments.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("comments.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("comments.deleteComment")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

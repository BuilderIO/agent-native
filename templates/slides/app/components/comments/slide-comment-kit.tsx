import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateReviewComment,
  useDeleteReviewComment,
  useReactToReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useUpdateReviewComment,
  type ListReviewCommentsResult,
} from "@agent-native/core/client/review";
import type { ReviewComment, ReviewMention } from "@agent-native/core/review";
import {
  isReviewAgentMention,
  MAX_REVIEW_COMMENT_IMAGES,
  resolveReviewAgent,
  ReviewCommentComposer,
  ReviewCommentItem,
  ReviewCommentMenu,
  reviewCommentEditAttachments,
  reviewCommentHiddenAttachments,
  reviewCommentImageMetadata,
  reviewCommentImages,
  useReviewCommentDraft,
  useReviewMentionPeople,
  type ReviewCommentDraft,
  type ReviewCommentDraftScope,
  type ReviewCommentDraftState,
  type ReviewMentionOption,
} from "@agent-native/toolkit/app/review";
import { DECK_REVIEW_RESOURCE, SLIDE_POINT_ANCHOR } from "@shared/deck-review";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { CommentThread } from "@/hooks/use-slide-comments";

export const SLIDES_AGENT_MENTION_ID = "agent:slides";
export const SLIDE_COMMENT_REACTIONS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "😮",
  "😢",
  "🙏",
] as const;

type Translate = ReturnType<typeof useT>;

function normalizedEmail(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}

export function isAgentSlideComment(comment: ReviewComment): boolean {
  return resolveReviewAgent(comment) !== null;
}

export function isOwnSlideComment(
  comment: ReviewComment,
  viewerEmail: string | null | undefined,
): boolean {
  const viewer = normalizedEmail(viewerEmail);
  return (
    viewer !== null &&
    !isAgentSlideComment(comment) &&
    normalizedEmail(comment.authorEmail) === viewer
  );
}

export function slideCommentMentionsViewer(
  comment: ReviewComment,
  viewerEmail: string | null | undefined,
): boolean {
  const viewer = normalizedEmail(viewerEmail);
  if (!viewer) return false;
  return (
    comment.mentions.some(
      (mention) => normalizedEmail(mention.email) === viewer,
    ) || comment.body.toLowerCase().includes(`@${viewer}`)
  );
}

export function slideCommentAuthorLabel(
  comment: ReviewComment,
  fallback: string,
): string {
  return (
    comment.authorName?.trim() ||
    (isAgentSlideComment(comment) ? "" : comment.authorEmail?.trim()) ||
    fallback
  );
}

function agentReplyPrompt(input: {
  deckId: string;
  slideId: string;
  threadId: string;
  rootId: string;
}): string {
  const { deckId, slideId, threadId, rootId } = input;
  return [
    `A comment on slide \`${slideId}\` of deck \`${deckId}\` mentions you (thread \`${threadId}\`).`,
    ``,
    `Read the thread with \`list-slide-comments\` (deckId \`${deckId}\`, slideId \`${slideId}\`). It returns one page of comments at a time: while \`has_more\` is true, call it again with the \`next_cursor\` it returned as \`cursor\`, so you see all of thread \`${threadId}\`. If the thread asks for a change to the slide, call \`view-screen\`, read the slide's HTML and contentHash with \`get-deck\`, then apply one bounded \`update-slide\` with that contentHash as \`baseContentHash\`.`,
    `Then answer in the thread with \`add-slide-comment\`, passing deckId \`${deckId}\`, slideId \`${slideId}\`, threadId \`${threadId}\` and parentId \`${rootId}\`.`,
  ].join("\n");
}

function slideCommentFormatLabels(t: Translate) {
  return {
    toolbar: t("comments.format.toolbar"),
    bold: t("comments.format.bold"),
    italic: t("comments.format.italic"),
    strike: t("comments.format.strike"),
    code: t("comments.format.code"),
    link: t("comments.format.link"),
    linkField: t("comments.format.linkField"),
    linkPlaceholder: t("comments.format.linkPlaceholder"),
    applyLink: t("comments.format.applyLink"),
    removeLink: t("comments.format.removeLink"),
  };
}

export interface SlideCommentKitOptions {
  deckId: string;
  surface: "panel" | "pins";
  currentUserEmail: string | null | undefined;
  canComment: boolean;
  discussion?: ListReviewCommentsResult["discussion"] | undefined;
  onBeforeCommentSubmit?: (() => Promise<void>) | undefined;
}

export interface NewSlideComment {
  slideId: string;
  draft: ReviewCommentDraft;
  quotedText?: string | null | undefined;
  anchor?: SlideCommentAnchor | null | undefined;
}

export function useSlideCommentKit({
  deckId,
  surface,
  currentUserEmail,
  canComment,
  discussion,
  onBeforeCommentSubmit,
}: SlideCommentKitOptions) {
  const t = useT();
  const { session } = useSession();
  const orgId = session?.orgId;
  const draftScope = useMemo<ReviewCommentDraftScope>(
    () => ({
      resourceType: DECK_REVIEW_RESOURCE,
      resourceId: deckId,
      userEmail: currentUserEmail,
      orgId,
    }),
    [currentUserEmail, deckId, orgId],
  );
  const people = useReviewMentionPeople();
  const agentLabel = t("comments.agentMention");
  const agentDescription = t("comments.agentMentionDescription");
  const mentionOptions = useMemo<ReviewMentionOption[]>(
    () => [
      ...people.people,
      {
        id: SLIDES_AGENT_MENTION_ID,
        label: agentLabel,
        description: agentDescription,
      },
    ],
    [agentDescription, agentLabel, people.people],
  );
  const createComment = useCreateReviewComment();
  const replyComment = useReplyReviewComment();
  const updateComment = useUpdateReviewComment();
  const deleteComment = useDeleteReviewComment();
  const resolveThread = useResolveReviewThread();
  const reactToComment = useReactToReviewComment();

  const handOffToAgent = useCallback(
    (
      mentions: readonly ReviewMention[],
      target: { slideId: string; threadId: string; rootId: string },
    ) => {
      if (!mentions.some(isReviewAgentMention)) return;
      void sendToAgentChatAndConfirm({
        message: agentReplyPrompt({ deckId, ...target }),
        submit: true,
        chatTarget: "local",
      }).then((delivery) => {
        if (!delivery.delivered)
          toast.error(t("floatingToolbar.agentUnavailable"));
      });
    },
    [deckId, t],
  );

  const createThread = useCallback(
    async ({ slideId, draft, quotedText, anchor }: NewSlideComment) => {
      await onBeforeCommentSubmit?.();
      const metadata = {
        ...(quotedText ? { quotedText } : {}),
        ...(draft.images.length
          ? { attachments: reviewCommentImageMetadata(draft.images) }
          : {}),
      };
      const comment = await createComment.mutateAsync({
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        surfaceId: slideId,
        body: draft.text,
        mentions: draft.mentions,
        ...(anchor ? { anchor, anchorKind: SLIDE_POINT_ANCHOR } : {}),
        ...(Object.keys(metadata).length ? { metadata } : {}),
      });
      handOffToAgent(draft.mentions, {
        slideId,
        threadId: comment.threadId,
        rootId: comment.id,
      });
      return comment;
    },
    [createComment, deckId, handOffToAgent, onBeforeCommentSubmit],
  );

  const reply = useCallback(
    async (thread: CommentThread, draft: ReviewCommentDraft) => {
      await onBeforeCommentSubmit?.();
      const comment = await replyComment.mutateAsync({
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        commentId: thread.root.id,
        body: draft.text,
        mentions: draft.mentions,
        ...(draft.images.length
          ? {
              metadata: {
                attachments: reviewCommentImageMetadata(draft.images),
              },
            }
          : {}),
      });
      const slideId = thread.slideId ?? comment.surfaceId;
      if (slideId) {
        handOffToAgent(draft.mentions, {
          slideId,
          threadId: thread.threadId,
          rootId: thread.root.id,
        });
      }
      return comment;
    },
    [deckId, handOffToAgent, onBeforeCommentSubmit, replyComment],
  );

  const update = useCallback(
    async (
      opened: ReviewComment,
      current: ReviewComment,
      draft: ReviewCommentDraft,
    ) => {
      const imagesChanged =
        JSON.stringify(draft.images) !==
        JSON.stringify(reviewCommentImages(opened));
      const updated = await updateComment.mutateAsync({
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        commentId: opened.id,
        body: draft.text,
        mentions: draft.mentions,
        ...(imagesChanged
          ? {
              attachments: reviewCommentEditAttachments(
                opened,
                current,
                draft.images,
              ),
            }
          : {}),
      });
      if (!opened.mentions.some(isReviewAgentMention) && current.surfaceId) {
        handOffToAgent(draft.mentions, {
          slideId: current.surfaceId,
          threadId: current.threadId,
          rootId: current.parentCommentId ?? current.id,
        });
      }
      return updated;
    },
    [deckId, handOffToAgent, updateComment],
  );

  const remove = useCallback(
    (comment: ReviewComment) =>
      deleteComment.mutateAsync({
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        commentId: comment.id,
      }),
    [deckId, deleteComment],
  );

  const setResolved = useCallback(
    (thread: CommentThread, resolved: boolean) =>
      resolveThread.mutateAsync({
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        threadId: thread.threadId,
        status: resolved ? "resolved" : "open",
      }),
    [deckId, resolveThread],
  );

  const react = useCallback(
    (comment: ReviewComment, reaction: string, active: boolean) =>
      reactToComment.mutateAsync({
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        commentId: comment.id,
        reaction,
        active,
      }),
    [deckId, reactToComment],
  );

  return {
    t,
    deckId,
    currentUserEmail: currentUserEmail ?? null,
    canComment,
    canReact: canComment && (discussion?.canReact ?? true),
    reactions: discussion?.reactions ?? {},
    draftScope,
    draftKey: (key: string) => `${surface}:${key}`,
    mentionOptions,
    mentionSearching: people.searching,
    mentionFailed: people.failed,
    onMentionQueryChange: people.onMentionQueryChange,
    updating: updateComment.isPending,
    resolving: resolveThread.isPending,
    canEditComment: (comment: ReviewComment) =>
      canComment && isOwnSlideComment(comment, currentUserEmail),
    canDeleteComment: (comment: ReviewComment, variant: "root" | "reply") =>
      canComment &&
      Boolean(variant === "root" ? comment.canDeleteThread : comment.canDelete),
    createThread,
    reply,
    update,
    remove,
    setResolved,
    react,
  };
}

export type SlideCommentKit = ReturnType<typeof useSlideCommentKit>;

export function useSlideCommentDraft(
  kit: SlideCommentKit,
  key: string | null,
): ReviewCommentDraftState {
  return useReviewCommentDraft(
    kit.draftScope,
    key === null ? null : kit.draftKey(key),
  );
}

export function slideCommentDraftSpot(
  anchor: SlideCommentAnchor | null | undefined,
  quotedText?: string | null,
): string {
  if (anchor) {
    const { x, y, textStartOffset, textEndOffset } = anchor;
    return [x, y, textStartOffset, textEndOffset]
      .map((part) => part ?? "")
      .join(",");
  }
  return quotedText ? `quote:${quotedText.slice(0, 100)}` : "";
}

function composerLabels(t: Translate) {
  return {
    agentsLabel: t("comments.agents"),
    emojiLabel: t("comments.addEmoji"),
    mentionLabel: t("comments.mention"),
    noMentionsLabel: t("comments.noMentions"),
    mentionFailedLabel: t("comments.mentionsFailed"),
    attachImageLabel: t("comments.attachImage"),
    removeImageLabel: t("comments.removeImage"),
    imageUploadFailedLabel: t("comments.imageUploadFailed"),
    formatLabels: slideCommentFormatLabels(t),
  };
}

export function SlideCommentComposerBox({
  kit,
  draft,
  variant = "expanded",
  placeholder,
  commentLabel,
  ariaLabel,
  failedLabel,
  autoFocus = false,
  onSubmit,
  onEscape,
  onCancel,
  className,
}: {
  kit: SlideCommentKit;
  draft: ReviewCommentDraftState;
  variant?: "expanded" | "reply";
  placeholder: string;
  commentLabel: string;
  ariaLabel?: string;
  failedLabel: string;
  autoFocus?: boolean;
  onSubmit: (draft: ReviewCommentDraft) => Promise<unknown>;
  onEscape?: () => void;
  onCancel?: () => void;
  className?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    target: string | null;
    message: string;
  } | null>(null);
  const submittingRef = useRef(false);
  const shownError = error?.target === draft.target ? error.message : null;

  const submit = () => {
    const text = draft.draft.text.trim();
    if ((!text && !draft.draft.images.length) || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const sent = draft;
    void onSubmit({ ...draft.draft, text })
      .then(
        () => sent.clear(),
        (caught: unknown) =>
          setError({
            target: sent.target,
            message: actionErrorMessage(caught) ?? failedLabel,
          }),
      )
      .finally(() => {
        submittingRef.current = false;
        setSubmitting(false);
      });
  };

  return (
    <div className={className}>
      <ReviewCommentComposer
        variant={variant}
        value={draft.draft.text}
        onChange={(text) => {
          draft.setText(text);
          if (error) setError(null);
        }}
        mentions={draft.draft.mentions}
        onMentionsChange={draft.setMentions}
        mentionOptions={kit.mentionOptions}
        onMentionQueryChange={kit.onMentionQueryChange}
        mentionOptionsLoading={kit.mentionSearching}
        mentionOptionsFailed={kit.mentionFailed}
        showCommentTools
        images={draft.draft.images}
        onImagesChange={draft.setImages}
        imageTarget={draft.target}
        {...composerLabels(kit.t)}
        autoFocus={autoFocus}
        disabled={submitting}
        submittingTarget={submitting ? "human" : null}
        onSubmit={submit}
        commentLabel={commentLabel}
        placeholder={placeholder}
        onEscape={onEscape}
        {...(ariaLabel ? { textareaProps: { "aria-label": ariaLabel } } : {})}
      />
      {shownError ? (
        <p role="alert" className="mt-1 text-[11px] text-destructive">
          {shownError}
        </p>
      ) : null}
      {onCancel ? (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground/80"
          >
            {kit.t("comments.cancel")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SlideCommentEntry({
  kit,
  comment,
  variant,
}: {
  kit: SlideCommentKit;
  comment: ReviewComment;
  variant: "root" | "reply";
}) {
  const { t } = kit;
  const [opened, setOpened] = useState<ReviewComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editInitial = useMemo(
    () =>
      opened
        ? {
            text: opened.body,
            mentions: [...opened.mentions],
            images: reviewCommentImages(opened),
          }
        : undefined,
    [opened],
  );
  const editDraft = useReviewCommentDraft(
    kit.draftScope,
    opened ? kit.draftKey(`edit:${opened.id}`) : null,
    editInitial,
  );
  const editMaxImages = useMemo(
    () =>
      Math.max(
        0,
        MAX_REVIEW_COMMENT_IMAGES -
          (opened ? reviewCommentHiddenAttachments(opened).length : 0),
      ),
    [opened],
  );

  const cancelEdit = () => {
    editDraft.clear();
    setOpened(null);
  };
  const saveEdit = () => {
    if (!opened || kit.updating) return;
    const text = editDraft.draft.text.trim();
    if (!text && !editDraft.draft.images.length) return;
    setError(null);
    const sent = editDraft;
    kit.update(opened, comment, { ...editDraft.draft, text }).then(
      () => {
        sent.clear();
        setOpened(null);
      },
      (caught: unknown) =>
        setError(actionErrorMessage(caught) ?? t("comments.saveCommentFailed")),
    );
  };
  const remove = () => {
    kit
      .remove(comment)
      .catch((caught: unknown) =>
        toast.error(actionErrorMessage(caught) ?? t("comments.deleteFailed")),
      );
  };
  const react = (target: ReviewComment, reaction: string, active: boolean) => {
    kit
      .react(target, reaction, active)
      .catch((caught: unknown) =>
        toast.error(actionErrorMessage(caught) ?? t("comments.reactionFailed")),
      );
  };

  const canEdit = kit.canEditComment(comment);
  const canDelete = kit.canDeleteComment(comment, variant);
  const author = slideCommentAuthorLabel(comment, t("comments.reviewer"));

  return (
    <div>
      <ReviewCommentItem
        comment={comment}
        variant={variant}
        className={variant === "root" ? "px-0 pt-0" : "px-0 pt-2.5"}
        reviewerLabel={t("comments.reviewer")}
        agentBadgeLabel={t("comments.agentBadge")}
        resolvedLabel={t("comments.resolved")}
        showReactions
        reactions={kit.reactions[comment.id] ?? []}
        canReact={kit.canReact}
        reactionChoices={SLIDE_COMMENT_REACTIONS}
        addReactionLabel={t("comments.addReaction")}
        reactionLabel={({ emoji, count, includesYou }) =>
          t(
            includesYou
              ? "comments.reaction.labelMine"
              : "comments.reaction.label",
            { emoji, count },
          )
        }
        onReact={react}
        menu={
          <ReviewCommentMenu
            moreActionsLabel={t("comments.moreActions")}
            ariaLabel={t("comments.moreActionsFor", { author })}
            editLabel={t("comments.editComment")}
            deleteLabel={
              variant === "root"
                ? t("comments.deleteThread")
                : t("comments.deleteComment")
            }
            onEdit={
              canEdit
                ? () => {
                    setError(null);
                    setOpened(comment);
                  }
                : undefined
            }
            onDelete={canDelete ? remove : undefined}
          />
        }
        editor={
          opened ? (
            <div className="space-y-1">
              <ReviewCommentComposer
                value={editDraft.draft.text}
                onChange={(text) => {
                  editDraft.setText(text);
                  if (error) setError(null);
                }}
                mentions={editDraft.draft.mentions}
                onMentionsChange={editDraft.setMentions}
                mentionOptions={kit.mentionOptions}
                onMentionQueryChange={kit.onMentionQueryChange}
                mentionOptionsLoading={kit.mentionSearching}
                mentionOptionsFailed={kit.mentionFailed}
                showCommentTools
                images={editDraft.draft.images}
                maxImages={editMaxImages}
                onImagesChange={editDraft.setImages}
                imageTarget={editDraft.target}
                {...composerLabels(t)}
                textareaProps={{ "aria-label": t("comments.editComment") }}
                autoFocus
                disabled={kit.updating}
                onSubmit={saveEdit}
                submittingTarget={kit.updating ? "human" : null}
                commentLabel={t("comments.save")}
                placeholder={t("comments.editComment")}
                onEscape={cancelEdit}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {t("comments.cancel")}
                </button>
              </div>
            </div>
          ) : undefined
        }
      />
      {error ? (
        <p role="alert" className="mt-1 ps-8 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

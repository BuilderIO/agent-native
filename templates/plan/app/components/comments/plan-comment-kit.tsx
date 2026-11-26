import { useT } from "@agent-native/core/client/i18n";
import { findCommentMentions } from "@agent-native/core/review/plain-text";
import type {
  ReviewComment,
  ReviewMention,
} from "@agent-native/core/review/types";
import {
  ReviewCommentComposer,
  ReviewCommentItem,
  ReviewCommentMenu,
  useReviewMentionPeople,
} from "@agent-native/toolkit/app/review";
import { formatPlanCommentMentionToken } from "@shared/comment-context";
import type { PlanCommentReaction } from "@shared/types";
import type { ReactNode } from "react";

import type { RuntimeAnnotationComment } from "@/lib/plan-annotation-runtime";

export const PLAN_COMMENT_REACTIONS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "😮",
  "😢",
  "🙏",
] as const;

export interface PlanCommentBoxDraft {
  text: string;
  mentions: ReviewMention[];
}

export const EMPTY_PLAN_COMMENT_BOX_DRAFT: PlanCommentBoxDraft = {
  text: "",
  mentions: [],
};

export type PlanCommentBoxUpdate = (
  update: (current: PlanCommentBoxDraft) => PlanCommentBoxDraft,
) => void;

export function planCommentBoxDraft(message: string): PlanCommentBoxDraft {
  return { text: message, mentions: [] };
}

export function planCommentMessage(draft: PlanCommentBoxDraft): string {
  const picked = findCommentMentions(draft.text, draft.mentions)
    .filter((found) => !found.inline)
    .sort((a, b) => b.at - a.at);
  let message = draft.text;
  for (const { at, source, mention } of picked) {
    const email = mention.email?.trim();
    if (!email) continue;
    message =
      message.slice(0, at) +
      formatPlanCommentMentionToken({ label: mention.label, email }) +
      message.slice(at + source.length);
  }
  return message;
}

export function planReviewComment(
  comment: RuntimeAnnotationComment,
): ReviewComment {
  const createdBy =
    comment.createdBy === "agent" || comment.createdBy === "import"
      ? comment.createdBy
      : "human";
  const createdAt = comment.createdAt ?? "";
  return {
    id: comment.id,
    resourceType: "plan",
    resourceId: "",
    threadId: comment.parentCommentId ?? comment.id,
    parentCommentId: comment.parentCommentId ?? null,
    targetId: null,
    kind: "comment",
    status: comment.status === "resolved" ? "resolved" : "open",
    anchor: null,
    body: comment.message,
    authorEmail: comment.authorEmail ?? null,
    authorName: comment.authorName ?? null,
    createdBy,
    resolutionTarget: null,
    mentions: [],
    ownerEmail: null,
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
    metadata: null,
  };
}

export function togglePlanCommentReaction(
  reactions: readonly PlanCommentReaction[],
  reaction: string,
  active: boolean,
): PlanCommentReaction[] {
  const given = reactions.find((item) => item.reaction === reaction);
  if (given?.reactedByMe === active) return [...reactions];
  if (active) {
    return given
      ? reactions.map((item) =>
          item === given
            ? { ...item, count: item.count + 1, reactedByMe: true }
            : item,
        )
      : [...reactions, { reaction, count: 1, reactedByMe: true }];
  }
  if (!given) return [...reactions];
  return given.count <= 1
    ? reactions.filter((item) => item !== given)
    : reactions.map((item) =>
        item === given
          ? { ...item, count: item.count - 1, reactedByMe: false }
          : item,
      );
}

export function PlanCommentBox({
  draft,
  onDraftChange,
  onSubmit,
  placeholder,
  commentLabel,
  ariaLabel,
  variant = "expanded",
  autoFocus = false,
  submitting = false,
  submitDisabled = false,
  onEscape,
  className,
}: {
  draft: PlanCommentBoxDraft;
  onDraftChange: PlanCommentBoxUpdate;
  onSubmit: () => void;
  placeholder: string;
  commentLabel: string;
  ariaLabel: string;
  variant?: "expanded" | "reply";
  autoFocus?: boolean;
  submitting?: boolean;
  submitDisabled?: boolean;
  onEscape?: () => void;
  className?: string;
}) {
  const t = useT();
  const people = useReviewMentionPeople();
  return (
    <ReviewCommentComposer
      variant={variant}
      value={draft.text}
      onChange={(text) => onDraftChange((current) => ({ ...current, text }))}
      mentions={draft.mentions}
      onMentionsChange={(mentions) =>
        onDraftChange((current) => ({ ...current, mentions }))
      }
      mentionOptions={people.people}
      onMentionQueryChange={people.onMentionQueryChange}
      mentionOptionsLoading={people.searching}
      mentionOptionsFailed={people.failed}
      showCommentTools
      emojiLabel={t("plansPage.comments.addEmoji")}
      mentionLabel={t("plansPage.comments.mention")}
      noMentionsLabel={t("plansPage.comments.noMatchingMembers")}
      mentionFailedLabel={t("plansPage.comments.mentionsFailed")}
      formatLabels={{
        toolbar: t("plansPage.comments.format.toolbar"),
        bold: t("plansPage.comments.format.bold"),
        italic: t("plansPage.comments.format.italic"),
        strike: t("plansPage.comments.format.strike"),
        code: t("plansPage.comments.format.code"),
        link: t("plansPage.comments.format.link"),
        linkField: t("plansPage.comments.format.linkField"),
        linkPlaceholder: t("plansPage.comments.format.linkPlaceholder"),
        applyLink: t("plansPage.comments.format.applyLink"),
        removeLink: t("plansPage.comments.format.removeLink"),
      }}
      autoFocus={autoFocus}
      disabled={submitting}
      submitDisabled={submitDisabled}
      submittingTarget={submitting ? "human" : null}
      onSubmit={() => onSubmit()}
      commentLabel={commentLabel}
      placeholder={placeholder}
      onEscape={onEscape}
      textareaProps={{ "aria-label": ariaLabel }}
      className={className}
    />
  );
}

export function PlanCommentEntry({
  comment,
  variant,
  reactions,
  showReactions,
  canReact,
  onReact,
  deleteLabel,
  onDelete,
  editor,
}: {
  comment: ReviewComment;
  variant: "root" | "reply";
  reactions: readonly PlanCommentReaction[];
  showReactions: boolean;
  canReact: boolean;
  onReact: (reaction: string, active: boolean) => void;
  deleteLabel: string;
  onDelete?: (() => void) | undefined;
  editor?: ReactNode;
}) {
  const t = useT();
  const author =
    comment.authorName ??
    comment.authorEmail ??
    t("plansPage.comments.reviewer");
  return (
    <ReviewCommentItem
      comment={comment}
      variant={variant}
      className="px-0 pt-0"
      reviewerLabel={t("plansPage.comments.reviewer")}
      agentBadgeLabel={t("plansPage.comments.agent")}
      resolvedLabel={t("plansPage.comments.resolved")}
      showReactions={showReactions}
      reactions={reactions}
      canReact={canReact}
      reactionChoices={PLAN_COMMENT_REACTIONS}
      addReactionLabel={t("plansPage.comments.addReaction")}
      reactionLabel={({ emoji, count, includesYou }) =>
        t(
          includesYou
            ? "plansPage.comments.reaction.labelMine"
            : "plansPage.comments.reaction.label",
          { emoji, count },
        )
      }
      onReact={(_comment, reaction, active) => onReact(reaction, active)}
      menu={
        onDelete ? (
          <ReviewCommentMenu
            moreActionsLabel={t("plansPage.comments.moreActions")}
            ariaLabel={t("plansPage.comments.moreActionsFor", { author })}
            deleteLabel={deleteLabel}
            onDelete={onDelete}
          />
        ) : undefined
      }
      editor={editor}
    />
  );
}

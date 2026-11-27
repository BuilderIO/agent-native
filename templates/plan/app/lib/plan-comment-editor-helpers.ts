import { emailToName } from "@agent-native/core/client/collab";
import type {
  PlanCommentMention,
  PlanCommentResolutionTarget,
} from "@shared/comment-context";

export type CommentDraft = {
  message: string;
  mentions: PlanCommentMention[];
  resolutionTarget: PlanCommentResolutionTarget;
};

export function displayNameForMention(email: string) {
  return emailToName(email).replace(/\s+/g, " ").trim() || email;
}

export function commentBodyText(message: string) {
  return message
    .replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canSubmitInlineCommentDraft(input: {
  draft: CommentDraft;
  isSubmitting?: boolean;
  lockToAgent?: boolean;
}) {
  const needsHumanMention =
    !input.lockToAgent &&
    input.draft.resolutionTarget === "human" &&
    input.draft.mentions.length === 0;
  return (
    commentBodyText(input.draft.message).length > 0 &&
    !needsHumanMention &&
    !input.isSubmitting
  );
}

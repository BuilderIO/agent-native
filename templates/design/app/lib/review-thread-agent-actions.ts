import type { ReviewComment } from "@agent-native/core/review";
import type { ReviewAgentIntent } from "@shared/review-agent";

/** The four agent items in a thread card's More menu. */
export type ReviewThreadAgentAction = "send" | "suggest" | "reply" | "apply";

/** The items that start a background review-agent run instead of opening the chat. */
export type ReviewThreadEngineAction = Exclude<ReviewThreadAgentAction, "send">;

export function isReviewThreadEngineAction(
  action: ReviewThreadAgentAction,
): action is ReviewThreadEngineAction {
  return action !== "send";
}

/** The run mode a menu item asks the review agent for. */
export function reviewAgentModeForMenuAction(
  action: ReviewThreadEngineAction,
): ReviewAgentIntent {
  return action === "apply" ? "apply-resolve" : action;
}

export interface ReviewThreadAgentDispatch {
  message: string;
  context: string;
  /** Send to agent opens the composer with the thread attached and waits for the user. */
  submit: false;
}

interface ReviewThreadForAgent {
  root: ReviewComment;
  replies: readonly ReviewComment[];
}

// The chat drops a send whose message is empty (`parseSubmitChatMessage`), so a
// context-only draft needs one character; the composer trims it before sending.
const EMPTY_COMPOSER_MESSAGE = " ";

export function buildReviewThreadAgentContext({
  designId,
  root,
  replies,
}: {
  designId: string;
  root: ReviewComment;
  replies: readonly ReviewComment[];
}): string {
  const replyText = replies
    .map((reply) => `${reply.authorName ?? "Reviewer"}: ${reply.body}`)
    .join("\n");
  return [
    `Design id: ${designId}`,
    `Review thread id: ${root.threadId}`,
    `Review comment id: ${root.id}`,
    `Screen id: ${root.targetId ?? "unknown"}`,
    `Feedback: ${root.body}`,
    replyText ? `Replies:\n${replyText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReviewThreadAgentDispatch({
  designId,
  thread,
}: {
  designId: string;
  thread: ReviewThreadForAgent;
}): ReviewThreadAgentDispatch {
  return {
    message: EMPTY_COMPOSER_MESSAGE,
    context: buildReviewThreadAgentContext({
      designId,
      root: thread.root,
      replies: thread.replies,
    }),
    submit: false,
  };
}

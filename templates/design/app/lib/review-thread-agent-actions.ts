import type { ReviewComment } from "@agent-native/core/review";

/** The four agent items in a thread card's More menu. */
export type ReviewThreadAgentAction = "send" | "suggest" | "reply" | "apply";

export interface ReviewThreadAgentDispatch {
  message: string;
  context: string;
  /** `false` opens the composer with the context attached and waits for the user. */
  submit: boolean;
  /** Mark the thread as agent work first; suggest and reply are conversation only. */
  routeToAgentQueue: boolean;
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

export function buildReviewThreadAgentDispatch(
  action: ReviewThreadAgentAction,
  { designId, thread }: { designId: string; thread: ReviewThreadForAgent },
): ReviewThreadAgentDispatch {
  const context = buildReviewThreadAgentContext({
    designId,
    root: thread.root,
    replies: thread.replies,
  });
  switch (action) {
    case "send":
      return {
        message: EMPTY_COMPOSER_MESSAGE,
        context,
        submit: false,
        routeToAgentQueue: true,
      };
    case "suggest":
      return {
        message:
          "Suggest changes for this selected design review thread only. Do not edit the design: describe the specific edits you would make, then wait for me to ask you to apply them.", // i18n-ignore agent dispatch prompt
        context,
        submit: true,
        routeToAgentQueue: false,
      };
    case "reply":
      return {
        message:
          'Answer this selected design review thread by posting your answer into it with `reply-review-comment`. Do not edit the design and do not resolve the thread. Set `resolutionTarget: "human"` if I need to decide something.', // i18n-ignore agent dispatch prompt
        context,
        submit: true,
        routeToAgentQueue: false,
      };
    case "apply":
      return {
        message:
          'Apply this selected design review thread only. When the edit is persisted and verified, resolve the thread with `resolve-review-thread` and a one-line `resolutionNote`. If it needs a human decision, reply with `reply-review-comment` and `resolutionTarget: "human"` instead, and do not resolve it.', // i18n-ignore agent dispatch prompt
        context,
        submit: true,
        routeToAgentQueue: true,
      };
  }
}

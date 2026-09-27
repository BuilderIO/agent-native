export interface PresentReviewState {
  commentsOpen: boolean;
  commentMode: boolean;
}

export function resolvePresentEscapeAction(
  state: PresentReviewState,
  reviewEmbed = false,
):
  | "close-comments"
  | "defer-to-comment-mode"
  | "stay-in-review-embed"
  | "exit-presentation" {
  if (state.commentsOpen) return "close-comments";
  if (state.commentMode) return "defer-to-comment-mode";
  if (reviewEmbed) return "stay-in-review-embed";
  return "exit-presentation";
}

export function shouldBlockPresentPageNavigation(
  state: PresentReviewState,
): boolean {
  return state.commentsOpen || state.commentMode;
}

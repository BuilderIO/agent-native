export interface PresentReviewState {
  commentsOpen: boolean;
  commentMode: boolean;
}

export function resolvePresentEscapeAction(
  state: PresentReviewState,
): "close-comments" | "defer-to-comment-mode" | "exit-presentation" {
  if (state.commentsOpen) return "close-comments";
  if (state.commentMode) return "defer-to-comment-mode";
  return "exit-presentation";
}

export function shouldBlockPresentPageNavigation(
  state: PresentReviewState,
): boolean {
  return state.commentsOpen || state.commentMode;
}

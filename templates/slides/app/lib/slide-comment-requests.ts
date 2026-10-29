import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";

/**
 * Asks the canvas pins to open a thread or start a draft. The panel and the
 * editor shortcuts live outside the canvas, and a request made before the
 * pins for that slide mount waits here until they do.
 */
export type SlideCommentRequest =
  | { kind: "open-thread"; slideId: string; threadId: string }
  | {
      kind: "draft";
      slideId: string;
      anchor: SlideCommentAnchor;
      quotedText?: string | undefined;
    };

const listeners = new Set<() => void>();
let pending: SlideCommentRequest | null = null;

export function requestSlideComment(request: SlideCommentRequest): void {
  pending = request;
  for (const listener of listeners) listener();
}

/** Takes the pending request for `slideId`, if there is one. */
export function takeSlideCommentRequest(
  slideId: string,
): SlideCommentRequest | null {
  if (pending?.slideId !== slideId) return null;
  const request = pending;
  pending = null;
  return request;
}

export function subscribeSlideCommentRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

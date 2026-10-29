import { z } from "zod";

import {
  slideCommentAnchorSchema,
  type SlideCommentAnchor,
} from "./slide-comment-anchor.js";

/** Slides review threads live on the deck's sharing resource. */
export const SLIDE_REVIEW_RESOURCE_TYPE = "deck";

/** The `?comment=` param an email link carries; the editor opens that thread. */
export const SLIDE_REVIEW_THREAD_PARAM = "comment";

export const slideReviewAnchorSchema = z
  .object({
    kind: z.literal("slide"),
    slideId: z.string().trim().min(1).max(200),
    quotedText: z.string().max(2_000).optional(),
    point: slideCommentAnchorSchema.optional(),
  })
  .strict();

/**
 * A review comment's anchor. `slideId` keeps the thread on its slide through
 * reorders; `point` places the pin on the canvas, relative to an object when
 * it has one, so the pin follows that object when it moves.
 */
export interface SlideReviewAnchor {
  kind: "slide";
  slideId: string;
  quotedText?: string | undefined;
  point?: SlideCommentAnchor | undefined;
}

export function slideReviewAnchor(input: {
  slideId: string;
  quotedText?: string | null | undefined;
  point?: SlideCommentAnchor | null | undefined;
}): SlideReviewAnchor {
  const quotedText = input.quotedText?.trim();
  return {
    kind: "slide",
    slideId: input.slideId,
    ...(quotedText ? { quotedText: quotedText.slice(0, 2_000) } : {}),
    ...(input.point ? { point: input.point } : {}),
  };
}

/** Null for a comment that is not a Slides anchor, such as a board-level note. */
export function parseSlideReviewAnchor(
  value: unknown,
): SlideReviewAnchor | null {
  const parsed = slideReviewAnchorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

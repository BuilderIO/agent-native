import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  assertSlideReviewAccess,
  legacySlideComments,
  listSlideReviewComments,
} from "../server/lib/slide-review-legacy.js";

const DEFAULT_COMMENT_PAGE_SIZE = 100;

export default defineAction({
  description:
    'Deprecated: use list-review-comments with resourceType "deck" (targetId is the slide id). Lists comments for one slide, or all comments in a deck when slideId is omitted, ordered by creation time. Returns the first bounded page of 100 comments by default; pass limit (max 200) and cursor for stable pagination, or offset for compatibility.',
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().optional().describe("Slide ID; omit for all slides"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Page size, up to 200; defaults to 100"),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Number of matching comments to skip; defaults to 0"),
    cursor: z
      .object({
        createdAt: z.string().min(1),
        id: z.string().min(1),
      })
      .optional()
      .describe("Continue after the last comment returned by the prior page"),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const offset = args.offset ?? 0;
    const pageLimit = args.limit ?? DEFAULT_COMMENT_PAGE_SIZE;
    await assertSlideReviewAccess(args.deckId, ctx, "viewer");
    const { comments, reactions, truncated } = await listSlideReviewComments(
      args.deckId,
      ctx,
      { slideId: args.slideId },
    );
    const ordered = legacySlideComments(comments, reactions).sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id),
    );
    const cursor = args.cursor;
    const afterCursor = cursor
      ? ordered.filter(
          (comment) =>
            comment.created_at > cursor.createdAt ||
            (comment.created_at === cursor.createdAt && comment.id > cursor.id),
        )
      : ordered.slice(offset);
    const hasMore = afterCursor.length > pageLimit;
    const visible = afterCursor.slice(0, pageLimit);
    const last = visible.at(-1);
    return {
      comments: visible,
      has_more: hasMore,
      next_offset: hasMore ? offset + pageLimit : null,
      next_cursor:
        hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
      limit: pageLimit,
      offset,
      // Pages cover only the oldest comments core returns in one read; when
      // this is true, newer comments exist past the last page.
      truncated,
    };
  },
});

import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  listSlideComments,
  toSlideCommentRows,
} from "../server/lib/slide-comments.js";

const DEFAULT_COMMENT_PAGE_SIZE = 100;

export default defineAction({
  description:
    "List comments for one slide, or all comments in a deck when slideId is omitted, ordered by creation time. Returns the first bounded page of 100 comments by default; pass limit (max 200) and cursor for stable pagination, or offset for compatibility.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().optional().describe("Slide ID; omit for all slides"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Page size, up to 200; omit to return every matching comment"),
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
  mcpTool: "search",
  run: async (args, ctx) => {
    const { deckId, slideId } = args;
    const offset = args.offset ?? 0;
    const pageLimit = args.limit ?? DEFAULT_COMMENT_PAGE_SIZE;
    await assertAccess("deck", deckId, "viewer");

    const { comments, hasMore } = await listSlideComments({
      deckId,
      slideId,
      limit: pageLimit,
      offset,
      cursor: args.cursor,
    });
    const last = comments.at(-1);
    return {
      comments: await toSlideCommentRows(comments, ctx),
      has_more: hasMore,
      next_offset: hasMore ? offset + pageLimit : null,
      next_cursor:
        hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
      limit: pageLimit,
      offset,
    };
  },
});

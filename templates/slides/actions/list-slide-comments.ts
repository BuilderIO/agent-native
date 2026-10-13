import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { resolveUserProfileName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, asc, eq, gt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseSlideCommentAnchor } from "../shared/slide-comment-anchor.js";
import { summarizeSlideCommentReactions } from "../shared/slide-comment-reactions.js";

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
  run: async (args) => {
    const { deckId, slideId } = args;
    const offset = args.offset ?? 0;
    const pageLimit = args.limit ?? DEFAULT_COMMENT_PAGE_SIZE;
    await assertAccess("deck", deckId, "viewer");

    const db = getDb();
    const viewerEmail = getRequestUserEmail();
    const filters = [eq(schema.slideComments.deckId, deckId)];
    if (slideId) filters.push(eq(schema.slideComments.slideId, slideId));
    if (args.cursor) {
      filters.push(
        or(
          gt(schema.slideComments.createdAt, args.cursor.createdAt),
          and(
            eq(schema.slideComments.createdAt, args.cursor.createdAt),
            gt(schema.slideComments.id, args.cursor.id),
          ),
        )!,
      );
    }
    const query = db
      .select()
      .from(schema.slideComments)
      .where(and(...filters))
      .orderBy(
        asc(schema.slideComments.createdAt),
        asc(schema.slideComments.id),
      );
    const rows = await query
      .limit(pageLimit + 1)
      .offset(args.cursor ? 0 : offset);
    const hasMore = rows.length > pageLimit;
    const visibleRows = hasMore ? rows.slice(0, pageLimit) : rows;
    const lastVisibleRow = visibleRows[visibleRows.length - 1];
    const profiles = await getUserProfiles(
      visibleRows.map((row) => row.authorEmail),
    );
    return {
      comments: visibleRows.map((row) => ({
        id: row.id,
        deck_id: row.deckId,
        slide_id: row.slideId,
        thread_id: row.threadId,
        parent_id: row.parentId,
        content: row.content,
        quoted_text: row.quotedText,
        anchor: parseSlideCommentAnchor(row.anchor),
        reactions: summarizeSlideCommentReactions(
          row.emojiReactionsJson,
          viewerEmail,
        ),
        author_email: row.authorEmail,
        author_name: resolveUserProfileName(
          row.authorEmail,
          row.authorName,
          profiles.get(row.authorEmail.toLowerCase())?.name,
        ),
        resolved: row.resolved,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      })),
      has_more: hasMore,
      next_offset: hasMore ? offset + pageLimit : null,
      next_cursor:
        hasMore && lastVisibleRow
          ? { createdAt: lastVisibleRow.createdAt, id: lastVisibleRow.id }
          : null,
      limit: pageLimit,
      offset,
    };
  },
});

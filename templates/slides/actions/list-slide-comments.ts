import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { resolveUserProfileName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js"; // ensure registerShareableResource runs
import { parseSlideCommentAnchor } from "../shared/slide-comment-anchor.js";
import { summarizeSlideCommentReactions } from "../shared/slide-comment-reactions.js";

export default defineAction({
  description:
    "List comments for one slide, or all comments in a deck when slideId is omitted, ordered by creation time. By default returns every matching comment; pass limit (max 200) and offset for paged reads, and inspect has_more/next_offset when paging.",
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
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { deckId, slideId } = args;
    const offset = args.offset ?? 0;
    const pageLimit = args.limit;
    await assertAccess("deck", deckId, "viewer");

    const db = getDb();
    const viewerEmail = getRequestUserEmail();
    const query = db
      .select()
      .from(schema.slideComments)
      .where(
        slideId
          ? and(
              eq(schema.slideComments.deckId, deckId),
              eq(schema.slideComments.slideId, slideId),
            )
          : eq(schema.slideComments.deckId, deckId),
      )
      .orderBy(asc(schema.slideComments.createdAt));
    const rows =
      pageLimit === undefined
        ? await query.offset(offset)
        : await query.limit(pageLimit + 1).offset(offset);
    const hasMore = pageLimit !== undefined && rows.length > pageLimit;
    const visibleRows =
      pageLimit === undefined || !hasMore ? rows : rows.slice(0, pageLimit);
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
      next_offset:
        pageLimit !== undefined && hasMore ? offset + pageLimit : null,
      limit: pageLimit ?? null,
      offset,
    };
  },
});

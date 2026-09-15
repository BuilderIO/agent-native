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
    "List comments for one slide, or all comments in a deck when slideId is omitted, ordered by creation time.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().optional().describe("Slide ID; omit for all slides"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { deckId, slideId } = args;
    await assertAccess("deck", deckId, "viewer");

    const db = getDb();
    const viewerEmail = getRequestUserEmail();
    const rows = await db
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
      .orderBy(asc(schema.slideComments.createdAt))
      .limit(200);
    const profiles = await getUserProfiles(rows.map((row) => row.authorEmail));
    return {
      comments: rows.map((row) => ({
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
    };
  },
});

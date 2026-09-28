import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseSlideCommentReactionBuckets,
  serializeSlideCommentReactionBuckets,
  summarizeSlideCommentReactions,
} from "../shared/slide-comment-reactions.js";

const MAX_CAS_ATTEMPTS = 3;

export default defineAction({
  description:
    "Toggle the current user's emoji reaction on a slide comment. Calling with the same emoji twice removes that reaction.",
  schema: z.object({
    commentId: z.string().min(1).describe("Comment ID"),
    deckId: z.string().min(1).describe("Deck ID"),
    emoji: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe("Emoji character or sequence (for example, 👍 or 🎉)"),
  }),
  run: async ({ commentId, deckId, emoji }) => {
    const viewerEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (!viewerEmail) {
      throw new Error("Sign in required to react to comments.");
    }
    await assertAccess("deck", deckId, "commenter");
    const normalizedEmoji = emoji.trim();

    const db = getDb();
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const [comment] = await db
        .select({
          emojiReactionsJson: schema.slideComments.emojiReactionsJson,
        })
        .from(schema.slideComments)
        .where(
          and(
            eq(schema.slideComments.id, commentId),
            eq(schema.slideComments.deckId, deckId),
          ),
        )
        .limit(1);
      if (!comment) throw new Error(`Comment not found: ${commentId}`);

      const previousJson = comment.emojiReactionsJson || "{}";
      const reactions = parseSlideCommentReactionBuckets(previousJson);
      const bucket = reactions[normalizedEmoji] ?? [];
      const had = bucket.some(
        (email) => email.trim().toLowerCase() === viewerEmail,
      );
      const nextBucket = had
        ? bucket.filter((email) => email.trim().toLowerCase() !== viewerEmail)
        : [...bucket, viewerEmail];
      const next = { ...reactions };
      if (nextBucket.length === 0) delete next[normalizedEmoji];
      else next[normalizedEmoji] = nextBucket;

      const updated = await db
        .update(schema.slideComments)
        .set({
          emojiReactionsJson: serializeSlideCommentReactionBuckets(next),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.slideComments.id, commentId),
            eq(schema.slideComments.deckId, deckId),
            eq(schema.slideComments.emojiReactionsJson, previousJson),
          ),
        )
        .returning({ id: schema.slideComments.id });

      if (updated.length > 0) {
        return {
          id: commentId,
          emoji: normalizedEmoji,
          reacted: !had,
          reactions: summarizeSlideCommentReactions(
            JSON.stringify(next),
            viewerEmail,
          ),
        };
      }
    }

    throw new Error(
      `Could not toggle reaction on comment ${commentId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});

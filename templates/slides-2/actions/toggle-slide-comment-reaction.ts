import {
  defineAction,
  fail,
  type WriteReceipt,
} from "@agent-native/core/action";
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
import { assertSlides2DeckData } from "./_deck-app-scope.js";

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
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ commentId, deckId, emoji }) => {
    const viewerEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (!viewerEmail) {
      fail("Sign in required to react to comments.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const access = await assertAccess("deck", deckId, "commenter");
    assertSlides2DeckData(access.resource.data);
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
      if (!comment) {
        fail(`Comment not found: ${commentId}`, {
          errorCode: "not_found",
          statusCode: 404,
        });
      }

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

      const nextJson = serializeSlideCommentReactionBuckets(next);
      const updated = await db
        .update(schema.slideComments)
        .set({
          emojiReactionsJson: nextJson,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.slideComments.id, commentId),
            eq(schema.slideComments.deckId, deckId),
            eq(schema.slideComments.emojiReactionsJson, previousJson),
          ),
        )
        .returning({
          id: schema.slideComments.id,
          emojiReactionsJson: schema.slideComments.emojiReactionsJson,
        });

      if (updated[0]?.id === commentId) {
        if (updated[0].emojiReactionsJson !== nextJson) {
          fail("Could not verify that the comment reaction was updated.", {
            errorCode: "write_not_verified",
            statusCode: 500,
          });
        }
        const reacted = !had;
        const _receipt: WriteReceipt = {
          changed: true,
          verified: true,
          subject: commentId,
          summary: `Reaction ${reacted ? "added" : "removed"}.`,
          checks: [
            {
              id: "slide-comment-reaction",
              ok: true,
              detail: "The saved reaction state matches the toggle.",
            },
          ],
        };
        return {
          id: commentId,
          emoji: normalizedEmoji,
          reacted,
          reactions: summarizeSlideCommentReactions(
            updated[0].emojiReactionsJson,
            viewerEmail,
          ),
          _receipt,
        };
      }
    }

    fail(
      `Could not toggle reaction on comment ${commentId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
      {
        errorCode: "concurrent_update",
        statusCode: 409,
      },
    );
  },
});

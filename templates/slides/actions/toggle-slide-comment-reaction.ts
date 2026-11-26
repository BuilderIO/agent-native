import { defineAction, fail } from "@agent-native/core/action";
import reactToReviewComment from "@agent-native/core/review/actions/react-to-review-comment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  DECK_REVIEW_RESOURCE,
  findSlideComment,
  slideCommentReactions,
  slideReviewContext,
} from "../server/lib/slide-comments.js";

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
      .max(32)
      .describe("Emoji character or sequence (for example, 👍 or 🎉)"),
  }),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  audit: {
    target: (args) => ({ type: "slide-comment", id: args.commentId }),
  },
  run: async ({ commentId, deckId, emoji }, ctx) => {
    const reviewCtx = slideReviewContext(ctx);
    if (!reviewCtx.userEmail?.trim()) {
      fail("Sign in required to react to comments.", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }
    await assertAccess("deck", deckId, "commenter");
    const comment = await findSlideComment(deckId, commentId);
    if (!comment) {
      fail(`Comment not found: ${commentId}`, {
        errorCode: "comment_not_found",
        statusCode: 404,
      });
    }

    const reaction = emoji.trim();
    const { active } = await reactToReviewComment.run(
      {
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: deckId,
        commentId: comment.id,
        reaction,
      },
      reviewCtx,
    );
    const reactions = await slideCommentReactions([comment], ctx);
    return {
      id: comment.id,
      emoji: reaction,
      reacted: active,
      // coercion-ok: a comment no one has reacted to has no entry, which is no reactions.
      reactions: reactions[comment.id] ?? [],
    };
  },
});

import { defineAction, fail } from "@agent-native/core/action";
import reactToReviewComment from "@agent-native/core/review/actions/react-to-review-comment";
import { z } from "zod";

import {
  assertSlideReviewAccess,
  legacySlideComments,
  listSlideReviewComments,
  slideReviewActionContext,
} from "../server/lib/slide-review-legacy.js";
import { SLIDE_REVIEW_RESOURCE_TYPE } from "../shared/slide-review.js";

export default defineAction({
  description:
    'Deprecated: use react-to-review-comment with resourceType "deck". Toggles the current user\'s emoji reaction on a slide comment. Calling with the same emoji twice removes that reaction.',
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
  run: async ({ commentId, deckId, emoji }, ctx) => {
    const reviewCtx = slideReviewActionContext(ctx);
    if (!reviewCtx.userEmail) {
      throw new Error("Sign in required to react to comments.");
    }
    await assertSlideReviewAccess(deckId, ctx, "commenter");
    const reaction = emoji.trim();
    const before = await listSlideReviewComments(deckId, ctx);
    if (!before.comments.some((comment) => comment.id === commentId)) {
      if (before.truncated) {
        fail(
          `Comment ${commentId} is past the comments this action can read; use react-to-review-comment.`,
          { errorCode: "too_many_comments", statusCode: 409 },
        );
      }
      fail(`Comment not found: ${commentId}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    const had = Boolean(
      before.reactions[commentId]?.some(
        (entry) => entry.reaction === reaction && entry.reactedByMe,
      ),
    );
    await reactToReviewComment.run(
      {
        resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
        resourceId: deckId,
        commentId,
        reaction,
        active: !had,
      },
      reviewCtx,
    );
    const after = await listSlideReviewComments(deckId, ctx);
    const updated = legacySlideComments(after.comments, after.reactions).find(
      (comment) => comment.id === commentId,
    );
    return {
      id: commentId,
      emoji: reaction,
      reacted: !had,
      reactions: updated?.reactions ?? [],
    };
  },
});

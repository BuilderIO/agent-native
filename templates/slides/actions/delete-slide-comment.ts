import { defineAction } from "@agent-native/core/action";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import { z } from "zod";

import {
  assertSlideReviewAccess,
  slideReviewActionContext,
} from "../server/lib/slide-review-legacy.js";
import { SLIDE_REVIEW_RESOURCE_TYPE } from "../shared/slide-review.js";

export default defineAction({
  description:
    'Deprecated: use delete-review-comment with resourceType "deck". Deletes a slide comment. Authors can delete their own comments; otherwise editor access is required.',
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().describe("Deck ID"),
  }),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  run: async (args, ctx) => {
    await assertSlideReviewAccess(args.deckId, ctx, "commenter");
    await deleteReviewComment.run(
      {
        resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
        resourceId: args.deckId,
        commentId: args.id,
      },
      slideReviewActionContext(ctx),
    );
    return { ok: true };
  },
});

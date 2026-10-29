import { defineAction, fail } from "@agent-native/core/action";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import updateReviewComment from "@agent-native/core/review/actions/update-review-comment";
import { z } from "zod";

import {
  assertSlideReviewAccess,
  slideReviewActionContext,
} from "../server/lib/slide-review-legacy.js";
import { SLIDE_REVIEW_RESOURCE_TYPE } from "../shared/slide-review.js";

export default defineAction({
  description:
    'Deprecated: use update-review-comment or resolve-review-thread with resourceType "deck". Updates a slide comment. Comment text supports inline Markdown without headings. Resolving or reopening a comment applies to the full thread.',
  schema: z
    .object({
      id: z.string().describe("Comment ID"),
      deckId: z.string().describe("Deck ID"),
      content: z.string().trim().min(1).optional().describe("New comment text"),
      resolved: z.boolean().optional().describe("Resolved state"),
    })
    .refine(
      (args) => args.content !== undefined || args.resolved !== undefined,
      "Provide comment content or a resolved state",
    )
    .refine(
      (args) => !(args.content !== undefined && args.resolved !== undefined),
      {
        message: "Provide either comment content or a resolved state, not both",
        path: ["content"],
      },
    ),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  run: async (args, ctx) => {
    if ((args.content === undefined) === (args.resolved === undefined)) {
      fail("Provide either comment content or a resolved state", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }
    await assertSlideReviewAccess(args.deckId, ctx, "commenter");
    const reviewCtx = slideReviewActionContext(ctx);
    if (args.resolved !== undefined) {
      await resolveReviewThread.run(
        {
          resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
          resourceId: args.deckId,
          commentId: args.id,
          status: args.resolved ? "resolved" : "open",
        },
        reviewCtx,
      );
      return { ok: true, resolved: args.resolved };
    }
    if (args.content === undefined) {
      return fail("Provide comment content or a resolved state", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }
    await updateReviewComment.run(
      {
        resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
        resourceId: args.deckId,
        commentId: args.id,
        body: args.content,
      },
      reviewCtx,
    );
    return { ok: true };
  },
});

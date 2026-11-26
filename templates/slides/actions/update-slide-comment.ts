import { defineAction, fail } from "@agent-native/core/action";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import updateReviewComment from "@agent-native/core/review/actions/update-review-comment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  DECK_REVIEW_RESOURCE,
  findSlideComment,
  slideReviewContext,
} from "../server/lib/slide-comments.js";

export default defineAction({
  description:
    "Update a slide comment. Comment text supports inline Markdown without headings. content and resolved can be sent together. A resolved change applies to the full thread; sending the current resolved value leaves the thread unchanged.",
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
    ),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  run: async (args, ctx) => {
    const hasContent = args.content !== undefined;
    if (!hasContent && args.resolved === undefined) {
      fail("Provide comment content or a resolved state", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }

    await assertAccess("deck", args.deckId, "commenter");
    const comment = await findSlideComment(args.deckId, args.id);
    if (!comment) {
      fail(`Comment not found: ${args.id}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const nextResolved =
      args.resolved !== undefined &&
      args.resolved !== (comment.status === "resolved")
        ? args.resolved
        : undefined;
    const reviewCtx = slideReviewContext(ctx);
    const resource = {
      resourceType: DECK_REVIEW_RESOURCE,
      resourceId: args.deckId,
    };

    if (args.content !== undefined) {
      await updateReviewComment.run(
        { ...resource, commentId: comment.id, body: args.content },
        reviewCtx,
      );
    }
    // Sending the thread's current resolved state alone changes nothing.
    if (nextResolved !== undefined) {
      await resolveReviewThread.run(
        {
          ...resource,
          threadId: comment.threadId,
          status: nextResolved ? "resolved" : "open",
        },
        reviewCtx,
      );
      return { ok: true, resolved: nextResolved };
    }

    return { ok: true };
  },
});

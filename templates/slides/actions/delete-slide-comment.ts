import { defineAction, fail } from "@agent-native/core/action";
import type { ReviewComment } from "@agent-native/core/review";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import {
  assertAccess,
  resolveAccess,
  ROLE_RANK,
} from "@agent-native/core/sharing";
import { z } from "zod";

import {
  DECK_REVIEW_RESOURCE,
  findSlideComment,
  slideCommentThread,
  slideReviewContext,
} from "../server/lib/slide-comments.js";
import { commentAuthorKind } from "../shared/comment-author.js";

// Deleting a thread's first comment deletes the whole thread; deleting a
// reply removes only that reply. Approval and the check in run() must see the
// same comments.
async function removedComments(
  deckId: string,
  comment: ReviewComment,
): Promise<ReviewComment[]> {
  return comment.parentCommentId
    ? [comment]
    : slideCommentThread(deckId, comment.threadId);
}

function isOtherPerson(
  authorEmail: string | null,
  viewerEmail: string | null | undefined,
) {
  return (
    (authorEmail ?? "").trim().toLowerCase() !==
    (viewerEmail ?? "").trim().toLowerCase()
  );
}

export default defineAction({
  description:
    "Delete a slide comment. Authors can delete their own comments; otherwise editor access is required. Deleting a thread's first comment deletes the whole thread, which needs editor access when it holds anyone else's reply.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().describe("Deck ID"),
  }),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  audit: {
    target: (args) => ({ type: "slide-comment", id: args.id }),
    summary: (_args, result) =>
      `Deleted ${(result as { removedIds: string[] }).removedIds.length} comment(s)`,
  },
  needsApproval: async ({ id, deckId }, ctx) => {
    if (commentAuthorKind(ctx?.caller) !== "agent") return false;
    // Only an editor may delete another person's words. Anyone else either
    // deletes only their own, or is refused, so there is nothing to approve.
    const access = await resolveAccess("deck", deckId);
    if (!access || ROLE_RANK[access.role] < ROLE_RANK.editor) return false;
    const target = await findSlideComment(deckId, id);
    if (!target) return false;
    const viewer = slideReviewContext(ctx).userEmail;
    return (await removedComments(deckId, target)).some((comment) =>
      isOtherPerson(comment.authorEmail, viewer),
    );
  },
  run: async (args, ctx) => {
    await assertAccess("deck", args.deckId, "commenter");
    const comment = await findSlideComment(args.deckId, args.id);
    if (!comment) {
      fail(`Comment not found: ${args.id}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const reviewCtx = slideReviewContext(ctx);
    const removed = await removedComments(args.deckId, comment);
    // Without an approval covering this call, the agent must not delete other
    // people's comments. A reply that lands between this check and the
    // delete still goes with its thread, as the kit's delete takes the
    // thread as it finds it.
    if (
      commentAuthorKind(ctx?.caller) === "agent" &&
      !ctx?.approvedToolCallKey &&
      removed.some((row) => isOtherPerson(row.authorEmail, reviewCtx.userEmail))
    ) {
      fail(
        "This thread now holds another person's reply. Ask the user before deleting it.",
        { errorCode: "approval_required", statusCode: 409 },
      );
    }

    // The kit allows its author or an editor to delete a comment, and a
    // thread holding other people's replies only to an editor.
    await deleteReviewComment.run(
      {
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: args.deckId,
        commentId: comment.id,
      },
      reviewCtx,
    );

    return { ok: true, removedIds: removed.map((row) => row.id) };
  },
});

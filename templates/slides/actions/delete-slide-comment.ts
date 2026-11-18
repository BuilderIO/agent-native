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

async function removedComments(
  deckId: string,
  comment: ReviewComment,
): Promise<ReviewComment[]> {
  return comment.parentCommentId
    ? [comment]
    : slideCommentThread(deckId, comment.threadId);
}

function isUnlinkedReply(
  comment: ReviewComment,
  thread: ReviewComment[],
): boolean {
  if (comment.parentCommentId) return false;
  const first =
    thread.find((other) => other.id === comment.threadId) ?? thread.at(0);
  return first !== undefined && first.id !== comment.id;
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
    if (isUnlinkedReply(comment, removed)) {
      fail(
        "This reply isn't linked to its thread yet, so deleting it would delete the whole thread. Try again after Slides restarts.",
        { errorCode: "reply_not_linked", statusCode: 409 },
      );
    }
    const onlyOwnComments =
      commentAuthorKind(ctx?.caller) === "agent" && !ctx?.approvedToolCallKey;
    if (
      onlyOwnComments &&
      removed.some((row) => isOtherPerson(row.authorEmail, reviewCtx.userEmail))
    ) {
      fail(
        "This thread now holds another person's reply. Ask the user before deleting it.",
        { errorCode: "approval_required", statusCode: 409 },
      );
    }

    await deleteReviewComment.run(
      {
        resourceType: DECK_REVIEW_RESOURCE,
        resourceId: args.deckId,
        commentId: comment.id,
        onlyOwnComments,
      },
      reviewCtx,
    );

    return { ok: true, removedIds: removed.map((row) => row.id) };
  },
});

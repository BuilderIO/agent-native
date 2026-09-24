import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  CommentAiOperationError,
  commentThreadDigest,
  completeCommentAiAttempt,
  markCommentAiRefreshRequired,
  requireCommentAiRequest,
  retainCommentAiAttemptPayload,
  serializeCommentAiRequest,
  updateCommentAiRequest,
  verifyCommentAiAttempt,
} from "../server/lib/comment-ai.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";
import { addCommentWithGuard, commentIdForIdempotency } from "./add-comment.js";

const payloadSchema = z.object({
  attemptId: z.string().min(1),
  content: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .describe("The answer to post in the original comment thread"),
});

export default defineAction({
  description:
    "Post one answer in this operation's original thread. Pass the latest attemptId from get-comment-ai-context. If the Page changed while reasoning, this returns refreshRequired; read context and reason again. This operation cannot edit or resolve the Page.",
  schema: payloadSchema,
  run: async (args, ctx) => {
    const request = await requireCommentAiRequest("reply");
    if (request.status === "replied") return serializeCommentAiRequest(request);
    const verification = await verifyCommentAiAttempt(request, args.attemptId);
    if (!verification.sourceRevisionMatches) {
      return markCommentAiRefreshRequired(request, verification.attempt);
    }
    try {
      const payload = payloadSchema.parse(
        await retainCommentAiAttemptPayload(request, args.attemptId, args),
      );
      const receiptId = commentIdForIdempotency(
        request.requesterEmail,
        request.documentId,
        `comment-ai:${request.id}:reply`,
      );
      const reply = await addCommentWithGuard(
        {
          documentId: request.documentId,
          threadId: request.threadId,
          parentId: request.rootCommentId,
          content: payload.content,
          clientOperationId: receiptId,
        },
        ctx,
        async (tx) => {
          const [document] = await tx
            .select()
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.id, request.documentId),
                eq(schema.documents.ownerEmail, request.ownerEmail),
              ),
            )
            .for("update");
          if (
            !document ||
            documentRevisionToken(document.bodyRevision, document.content) !==
              verification.attempt.sourceRevision
          ) {
            throw new CommentAiOperationError(
              "page_changed",
              "The Page changed before the answer was saved",
              true,
            );
          }
          const comments = await tx
            .select()
            .from(schema.documentComments)
            .where(
              and(
                eq(schema.documentComments.documentId, request.documentId),
                eq(schema.documentComments.threadId, request.threadId),
                eq(schema.documentComments.ownerEmail, request.ownerEmail),
              ),
            )
            .for("update");
          if (
            commentThreadDigest(
              comments.filter((comment) => comment.id !== receiptId),
            ) !== verification.attempt.threadDigest
          ) {
            throw new CommentAiOperationError(
              "discussion_changed",
              "The comment discussion changed before the answer was saved",
              false,
            );
          }
        },
      );
      await completeCommentAiAttempt(args.attemptId, "completed");
      return updateCommentAiRequest(request, {
        status: "replied",
        result: { commentId: reply.id },
      });
    } catch (error) {
      if (
        error instanceof CommentAiOperationError &&
        error.code === "page_changed"
      ) {
        return markCommentAiRefreshRequired(request, verification.attempt);
      }
      const typed =
        error instanceof CommentAiOperationError
          ? error
          : new CommentAiOperationError(
              "operation_failed",
              error instanceof Error
                ? error.message
                : "The answer could not be completed",
              false,
            );
      await completeCommentAiAttempt(args.attemptId, "needs-review", typed);
      await updateCommentAiRequest(request, {
        status: "needs-review",
        errorCode: typed.code,
        error: typed.message,
      });
      throw typed;
    }
  },
});

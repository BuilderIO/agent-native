import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  assertCommentAiSourceUnchanged,
  commentThreadDigest,
  requireCommentAiRequest,
  retainCommentAiPayload,
  serializeCommentAiRequest,
  updateCommentAiRequest,
} from "../server/lib/comment-ai.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";
import { addCommentWithGuard, commentIdForIdempotency } from "./add-comment.js";

const payloadSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .describe("The answer to post in the original comment thread"),
});
export default defineAction({
  description:
    "Post one AI answer in this request's original thread. This operation cannot edit the Page or resolve feedback. Repeated calls recover the same answer.",
  schema: payloadSchema,
  run: async (args, ctx) => {
    const request = await requireCommentAiRequest("reply");
    if (request.status === "replied") return serializeCommentAiRequest(request);
    try {
      await assertCommentAiSourceUnchanged(request);
      const payload = payloadSchema.parse(
        await retainCommentAiPayload(request, args),
      );
      const reply = await addCommentWithGuard(
        {
          documentId: request.documentId,
          threadId: request.threadId,
          parentId: request.rootCommentId,
          content: payload.content,
          idempotencyKey: `comment-ai:${request.id}:reply`,
        },
        ctx,
        async (tx) => {
          const [document] = await tx
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, request.documentId));
          if (
            !document ||
            documentRevisionToken(document.bodyRevision, document.content) !==
              request.baseRevision
          )
            throw new Error(
              "The Page changed during this request; review the comment before retrying",
            );
          const comments = await tx
            .select()
            .from(schema.documentComments)
            .where(
              and(
                eq(schema.documentComments.documentId, request.documentId),
                eq(schema.documentComments.threadId, request.threadId),
              ),
            )
            .for("update");
          const receiptId = commentIdForIdempotency(
            request.requesterEmail,
            request.documentId,
            `comment-ai:${request.id}:reply`,
          );
          if (
            commentThreadDigest(
              comments.filter((comment) => comment.id !== receiptId),
            ) !== request.threadDigest
          )
            throw new Error(
              "The comment changed during this request; review its latest replies",
            );
        },
      );
      return await updateCommentAiRequest(request, {
        status: "replied",
        result: { commentId: reply.id },
      });
    } catch (error) {
      await updateCommentAiRequest(request, {
        status: "needs-review",
        error:
          error instanceof Error
            ? error.message
            : "The reply could not be completed",
      });
      throw error;
    }
  },
});

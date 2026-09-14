import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertCommentAiSourceUnchanged,
  commentThreadDigest,
  requireCommentAiRequest,
  retainCommentAiPayload,
  serializeCommentAiRequest,
  updateCommentAiRequest,
} from "../server/lib/comment-ai.js";
import {
  documentContentHash,
  type DocumentEditMutationResult,
} from "./_document-edit-mutation.js";
import addComment from "./add-comment.js";
import editDocument from "./edit-document.js";

const payloadSchema = z.object({
  edits: z
    .array(
      z.object({
        find: z.string().min(1).max(24000),
        replace: z.string().max(24000),
      }),
    )
    .min(1)
    .max(20),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("Concise receipt explaining the applied change"),
});
export default defineAction({
  description:
    "Apply the requested exact edits, verify the saved revision, post one receipt and resolve the original thread. On conflict the thread stays open. Retries replay the retained edit and resume unfinished steps; never claim rollback of an applied edit.",
  schema: payloadSchema,
  run: async (args, ctx) => {
    const request = await requireCommentAiRequest("apply-resolve");
    if (request.status === "resolved")
      return serializeCommentAiRequest(request);
    let result = serializeCommentAiRequest(request).result ?? {};
    try {
      await assertCommentAiSourceUnchanged(request);
      const payload = payloadSchema.parse(
        await retainCommentAiPayload(request, args),
      );
      const edit = (await editDocument.run(
        {
          id: request.documentId,
          edits: payload.edits,
          baseRevision: request.baseRevision,
          idempotencyKey: `comment-ai:${request.id}:edit`,
        },
        { ...ctx, caller: "tool" },
      )) as DocumentEditMutationResult;
      if (edit.receipt.outcome !== "applied" || !edit.receipt.readback.verified)
        throw new Error(
          "No verified change was applied; the comment remains open",
        );
      result = { ...result, editApplied: true };
      await updateCommentAiRequest(request, { status: "running", result });
      const reply = await addComment.run(
        {
          documentId: request.documentId,
          threadId: request.threadId,
          parentId: request.rootCommentId,
          content: payload.summary,
          idempotencyKey: `comment-ai:${request.id}:receipt`,
        },
        ctx,
      );
      result = { ...result, commentId: reply.id };
      await updateCommentAiRequest(request, { status: "running", result });
      await getDb().transaction(async (tx) => {
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
          documentContentHash(document.content) !== edit.receipt.hashes.after
        )
          throw new Error(
            "The Page changed after the edit was saved; the comment remains open for review",
          );
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
          commentThreadDigest(comments.filter((c) => c.id !== reply.id)) !==
          request.threadDigest
        )
          throw new Error(
            "The comment changed after the edit was saved; its thread remains open for review",
          );
        await tx
          .update(schema.documentComments)
          .set({ resolved: 1, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(schema.documentComments.documentId, request.documentId),
              eq(schema.documentComments.threadId, request.threadId),
              eq(schema.documentComments.ownerEmail, request.ownerEmail),
            ),
          );
        await tx
          .update(schema.commentAiRequests)
          .set({
            status: "resolved",
            resultJson: JSON.stringify({ ...result, resolved: true }),
            error: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.commentAiRequests.id, request.id));
      });
      return await updateCommentAiRequest(request, {
        status: "resolved",
        result: { ...result, resolved: true },
      });
    } catch (error) {
      await updateCommentAiRequest(request, {
        status: "needs-review",
        result,
        error:
          error instanceof Error
            ? error.message
            : "The operation could not be completed",
      });
      throw error;
    }
  },
});

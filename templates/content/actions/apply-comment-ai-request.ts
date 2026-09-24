import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
import type { CommentAiAppliedChange } from "../shared/comment-ai.js";
import { resolveDocumentTextEdits } from "../shared/document-text-edits.js";
import {
  documentRevisionToken,
  type DocumentEditMutationResult,
} from "./_document-edit-mutation.js";
import addComment, { commentIdForIdempotency } from "./add-comment.js";
import editDocument from "./edit-document.js";

const payloadSchema = z.object({
  attemptId: z.string().min(1),
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

const CHANGE_PREVIEW_LIMIT = 600;
const CHANGE_PREVIEW_COUNT = 5;

/** Bounded before/after text so the resolved thread can show what changed. */
export function appliedChangePreview(
  edits: Array<{ find: string; replace: string }>,
): CommentAiAppliedChange[] {
  return edits.slice(0, CHANGE_PREVIEW_COUNT).map(({ find, replace }) => ({
    before: find.slice(0, CHANGE_PREVIEW_LIMIT),
    after: replace.slice(0, CHANGE_PREVIEW_LIMIT),
    ...(find.length > CHANGE_PREVIEW_LIMIT ||
    replace.length > CHANGE_PREVIEW_LIMIT
      ? { truncated: true }
      : {}),
  }));
}

function targetError(kind: "missing" | "ambiguous" | "overlapping") {
  return new CommentAiOperationError(
    kind === "ambiguous" ? "target_ambiguous" : "target_deleted",
    kind === "ambiguous"
      ? "The requested text occurs more than once in the latest Page"
      : kind === "missing"
        ? "The requested text no longer exists in the latest Page"
        : "The requested edits overlap in the latest Page",
    false,
  );
}

export default defineAction({
  description:
    "Apply exact edits against the latest Page, verify the save, post one receipt, and resolve the source thread. Pass the latest attemptId from get-comment-ai-context. Unrelated edits are tolerated when every target remains unique; true overlap stays open as a typed review conflict.",
  schema: payloadSchema,
  run: async (args, ctx) => {
    const request = await requireCommentAiRequest("apply-resolve");
    if (request.status === "resolved") {
      return serializeCommentAiRequest(request);
    }
    const verification = await verifyCommentAiAttempt(request, args.attemptId);
    let result = serializeCommentAiRequest(request).result ?? {};
    try {
      const payload = payloadSchema.parse(
        await retainCommentAiAttemptPayload(request, args.attemptId, args),
      );
      if (!result.editApplied) {
        const resolved = resolveDocumentTextEdits(
          verification.source.document.content,
          payload.edits,
        );
        if (!resolved.ok) throw targetError(resolved.error.kind);
        const edit = (await editDocument.run(
          {
            id: request.documentId,
            edits: payload.edits,
            baseRevision: documentRevisionToken(
              verification.source.document.bodyRevision,
              verification.source.document.content,
            ),
            idempotencyKey: `comment-ai:${request.id}:edit`,
          },
          { ...ctx, caller: "tool" },
        )) as DocumentEditMutationResult;
        if (
          edit.receipt.outcome !== "applied" ||
          !edit.receipt.readback.verified
        ) {
          throw new CommentAiOperationError(
            "operation_failed",
            "No verified change was applied; the comment remains open",
            false,
          );
        }
        result = {
          ...result,
          editApplied: true,
          changes: appliedChangePreview(payload.edits),
          // Undo finds each replacement again, so an empty one (a pure
          // deletion) has nothing to find.
          undoable: payload.edits.every((edit) => edit.replace.length > 0),
        };
        await updateCommentAiRequest(request, { status: "running", result });
      }

      const reply = await addComment.run(
        {
          documentId: request.documentId,
          threadId: request.threadId,
          parentId: request.rootCommentId,
          content: payload.summary,
          clientOperationId: commentIdForIdempotency(
            request.requesterEmail,
            request.documentId,
            `comment-ai:${request.id}:receipt`,
          ),
        },
        ctx,
      );
      result = { ...result, commentId: reply.id };
      await updateCommentAiRequest(request, { status: "running", result });

      const now = new Date().toISOString();
      await getDb().transaction(async (tx) => {
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
            comments.filter((comment) => comment.id !== reply.id),
          ) !== verification.attempt.threadDigest
        ) {
          throw new CommentAiOperationError(
            "discussion_changed",
            "The comment discussion changed after the edit was saved; the thread remains open",
            false,
          );
        }
        await tx
          .update(schema.documentComments)
          .set({ resolved: 1, updatedAt: now })
          .where(
            and(
              eq(schema.documentComments.documentId, request.documentId),
              eq(schema.documentComments.threadId, request.threadId),
              eq(schema.documentComments.ownerEmail, request.ownerEmail),
            ),
          );
        await tx
          .update(schema.commentAiAttempts)
          .set({
            status: "completed",
            errorCode: null,
            error: null,
            updatedAt: now,
          })
          .where(eq(schema.commentAiAttempts.id, args.attemptId));
        await tx
          .update(schema.commentAiRequests)
          .set({
            status: "resolved",
            resultJson: JSON.stringify({ ...result, resolved: true }),
            errorCode: null,
            error: null,
            updatedAt: now,
          })
          .where(eq(schema.commentAiRequests.id, request.id));
      });
      return serializeCommentAiRequest(
        await (async () => {
          const [current] = await getDb()
            .select()
            .from(schema.commentAiRequests)
            .where(eq(schema.commentAiRequests.id, request.id));
          if (!current) throw new Error("Comment AI operation not found");
          return current;
        })(),
      );
    } catch (error) {
      if (!(error instanceof CommentAiOperationError)) {
        const latest = await verifyCommentAiAttempt(request, args.attemptId);
        const priorRevision = documentRevisionToken(
          verification.source.document.bodyRevision,
          verification.source.document.content,
        );
        const latestRevision = documentRevisionToken(
          latest.source.document.bodyRevision,
          latest.source.document.content,
        );
        if (latestRevision !== priorRevision && !result.editApplied) {
          return markCommentAiRefreshRequired(request, verification.attempt);
        }
      }
      const typed =
        error instanceof CommentAiOperationError
          ? error
          : new CommentAiOperationError(
              "operation_failed",
              error instanceof Error
                ? error.message
                : "The operation could not be completed",
              false,
            );
      await completeCommentAiAttempt(args.attemptId, "needs-review", typed);
      await updateCommentAiRequest(request, {
        status: "needs-review",
        result,
        errorCode: typed.code,
        error: typed.message,
      });
      throw typed;
    }
  },
});

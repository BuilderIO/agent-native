import { defineAction } from "@agent-native/core/action";
import createSuggestion from "@agent-native/core/review/suggestions/actions/create-resource-suggestion";
import listSuggestions from "@agent-native/core/review/suggestions/actions/list-resource-suggestions";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { markdownSuggestionOperation } from "../app/components/editor/suggestions/markdown-operation.js";
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
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "../server/lib/suggested-edits.js";
import type { CommentAiRequest } from "../shared/comment-ai.js";
import { resolveDocumentTextEdits } from "../shared/document-text-edits.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";
import { addCommentWithGuard, commentIdForIdempotency } from "./add-comment.js";

const payloadSchema = z.object({
  attemptId: z.string().min(1),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      "One or two sentences to the commenter about this change, including anything they should check; shown on the suggestion in their comment thread",
    ),
  find: z
    .string()
    .min(1)
    .max(24000)
    .describe("Exact unique text to propose replacing"),
  replace: z
    .string()
    .max(24000)
    .describe("Proposed replacement; canonical text remains unchanged"),
});

/**
 * Earlier pending proposals the requester got in this thread are replaced by
 * a revision instead of stacking up. Only requests made before this one count,
 * so a retry builds the same list and its creation receipt still matches.
 */
async function supersededSuggestionIds(
  request: Awaited<ReturnType<typeof requireCommentAiRequest>>,
  ctx: Parameters<typeof listSuggestions.run>[1],
) {
  const earlier = await getDb()
    .select({ id: schema.commentAiRequests.id })
    .from(schema.commentAiRequests)
    .where(
      and(
        eq(schema.commentAiRequests.documentId, request.documentId),
        eq(schema.commentAiRequests.threadId, request.threadId),
        eq(schema.commentAiRequests.requesterEmail, request.requesterEmail),
        lt(schema.commentAiRequests.createdAt, request.createdAt),
      ),
    );
  if (!earlier.length) return [];
  const earlierIds = new Set(earlier.map((row) => row.id));
  const { suggestions } = await listSuggestions.run(
    { resourceType: "document", resourceId: request.documentId },
    ctx,
  );
  return suggestions
    .filter(
      (suggestion) =>
        suggestion.adapterKind === CONTENT_DOCUMENT_SUGGESTION_ADAPTER &&
        suggestion.authorEmail === request.requesterEmail &&
        suggestion.metadata?.sourceThreadId === request.threadId &&
        earlierIds.has(String(suggestion.metadata?.commentAiRequestId)),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-20)
    .map((suggestion) => suggestion.id);
}

function suggestionResult(request: CommentAiRequest) {
  if (!request.result?.suggestionId) {
    throw new Error("The completed proposal has no suggestion result");
  }
  return {
    ...request,
    urlPath: `/page/${encodeURIComponent(request.documentId)}?suggestion=${encodeURIComponent(request.result.suggestionId)}`,
  };
}

function targetError(kind: "missing" | "ambiguous" | "overlapping") {
  if (kind === "ambiguous") {
    return new CommentAiOperationError(
      "target_ambiguous",
      "The proposed text occurs more than once in the latest Page",
      false,
    );
  }
  return new CommentAiOperationError(
    "target_deleted",
    kind === "missing"
      ? "The proposed text no longer exists in the latest Page"
      : "The proposed edits overlap in the latest Page",
    false,
  );
}

export default defineAction({
  description:
    "Create one anchored suggestion against the latest Page text and link it to the original feedback. Pass the latest attemptId from get-comment-ai-context. Unrelated edits are tolerated when the exact target remains unique; missing or repeated targets become typed review conflicts. A new suggestion on the same comment replaces the requester's earlier pending one, so never ask them to reject it.",
  schema: payloadSchema,
  run: async (args, ctx) => {
    const request = await requireCommentAiRequest("suggest");
    if (request.status === "suggested") {
      return suggestionResult(serializeCommentAiRequest(request));
    }
    const verification = await verifyCommentAiAttempt(request, args.attemptId);
    try {
      const payload = payloadSchema.parse(
        await retainCommentAiAttemptPayload(request, args.attemptId, args),
      );
      const proposed = resolveDocumentTextEdits(
        verification.source.document.content,
        [{ find: payload.find, replace: payload.replace }],
      );
      if (!proposed.ok) throw targetError(proposed.error.kind);
      const operation = markdownSuggestionOperation(
        verification.source.document.content,
        proposed.content,
      );
      if (!operation) {
        throw new CommentAiOperationError(
          "target_deleted",
          "The proposal does not change the latest Page text",
          false,
        );
      }
      const supersedes = await supersededSuggestionIds(request, ctx);
      const suggestion = await createSuggestion.run(
        {
          ...(supersedes.length ? { supersedes } : {}),
          resourceType: "document",
          resourceId: request.documentId,
          adapterKind: CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
          baseRevision: verification.source.document.updatedAt,
          summary: payload.summary,
          idempotencyKey: `comment-ai:${request.id}:suggestion`,
          operations: [operation],
          metadata: {
            sourceCommentId: request.rootCommentId,
            sourceThreadId: request.threadId,
            sourceUrl: `/page/${encodeURIComponent(request.documentId)}?comment=${encodeURIComponent(request.threadId)}`,
            commentAiRequestId: request.id,
            commentAiOperationId: request.id,
            commentAiAttemptId: args.attemptId,
            agentThreadId: request.agentThreadId,
            runId: request.runId,
            model: request.model,
          },
        },
        ctx,
      );
      await updateCommentAiRequest(request, {
        status: "running",
        result: { suggestionId: suggestion.id },
      });
      const receiptId = commentIdForIdempotency(
        request.requesterEmail,
        request.documentId,
        `comment-ai:${request.id}:receipt`,
      );
      const reply = await addCommentWithGuard(
        {
          documentId: request.documentId,
          threadId: request.threadId,
          parentId: request.rootCommentId,
          content: `[${payload.summary.replace(/[\[\]]/g, "")}](/page/${encodeURIComponent(request.documentId)}?suggestion=${encodeURIComponent(suggestion.id)})`,
          clientOperationId: receiptId,
        },
        ctx,
        async (tx) => {
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
              "The comment discussion changed before the proposal receipt was saved",
              false,
            );
          }
        },
      );
      await completeCommentAiAttempt(args.attemptId, "completed");
      return suggestionResult(
        await updateCommentAiRequest(request, {
          status: "suggested",
          result: { suggestionId: suggestion.id, commentId: reply.id },
        }),
      );
    } catch (error) {
      const latest = await verifyCommentAiAttempt(request, args.attemptId);
      if (
        documentRevisionToken(
          latest.source.document.bodyRevision,
          latest.source.document.content,
        ) !==
          documentRevisionToken(
            verification.source.document.bodyRevision,
            verification.source.document.content,
          ) &&
        !(error instanceof CommentAiOperationError)
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
                : "The proposal could not be completed",
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

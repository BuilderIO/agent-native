import { defineAction } from "@agent-native/core/action";
import createSuggestion from "@agent-native/core/review/suggestions/actions/create-resource-suggestion";
import createSuggestionProposal from "@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal";
import listSuggestions from "@agent-native/core/review/suggestions/actions/list-resource-suggestions";
import { and, eq, lt } from "drizzle-orm";
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
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "../server/lib/suggested-edits.js";
import type { CommentAiRequest } from "../shared/comment-ai.js";
import { resolveDocumentTextEdits } from "../shared/document-text-edits.js";
import {
  markdownSuggestionOperationsForFindReplaceEdits,
  markdownSuggestionOperationSummary,
} from "../shared/suggestion-diff.js";
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
  edits: z
    .array(
      z.object({
        find: z
          .string()
          .min(1)
          .max(24000)
          .describe("Exact unique text to propose replacing"),
        replace: z
          .string()
          .max(24000)
          .describe("Proposed replacement; canonical text remains unchanged"),
      }),
    )
    .min(1)
    .max(20)
    .describe(
      "One entry per separate change. Each find holds the words that change plus only enough surrounding text to occur once, so changes in different places become separate edits instead of one span of unchanged text between them.",
    ),
});

/**
 * Earlier pending proposals the requester got in this thread are replaced by
 * a revision instead of stacking up. Only requests made before this one count,
 * so a retry builds the same list and its creation receipt still matches. The
 * one exception is this request's own edits in the other shape: a retry that
 * turns one edit into several, or several into one, replaces what the earlier
 * attempt created.
 */
async function supersededSuggestionIds(
  request: Awaited<ReturnType<typeof requireCommentAiRequest>>,
  ctx: Parameters<typeof listSuggestions.run>[1],
  asProposal: boolean,
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
  const earlierIds = new Set(earlier.map((row) => row.id));
  // Only an earlier request, or an attempt of this one that already created
  // edits, can have left edits to replace.
  if (
    !earlierIds.size &&
    !serializeCommentAiRequest(request).result?.suggestionId
  ) {
    return [];
  }
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
        (earlierIds.has(String(suggestion.metadata?.commentAiRequestId)) ||
          (suggestion.metadata?.commentAiRequestId === request.id &&
            Boolean(suggestion.proposalId) !== asProposal)),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-100)
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
    "Propose anchored edits against the latest Page text, reviewed in the comment thread that asked for them. Pass the latest attemptId from get-comment-ai-context. Unrelated edits are tolerated when each exact target remains unique; missing, repeated, or overlapping targets become typed review conflicts. New edits on the same comment replace the requester's earlier pending ones, so never ask them to reject those.",
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
        payload.edits,
      );
      if (!proposed.ok) throw targetError(proposed.error.kind);
      const operations = markdownSuggestionOperationsForFindReplaceEdits({
        before: verification.source.document.content,
        edits: proposed.ranges,
      });
      if (!operations.length) {
        throw new CommentAiOperationError(
          "target_deleted",
          "The proposal does not change the latest Page text",
          false,
        );
      }
      const supersedes = await supersededSuggestionIds(
        request,
        ctx,
        operations.length > 1,
      );
      const proposal = {
        ...(supersedes.length ? { supersedes } : {}),
        resourceType: "document",
        resourceId: request.documentId,
        adapterKind: CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
        baseRevision: verification.source.document.updatedAt,
        summary: payload.summary,
      };
      const metadata = {
        sourceCommentId: request.rootCommentId,
        sourceThreadId: request.threadId,
        sourceUrl: `/page/${encodeURIComponent(request.documentId)}?comment=${encodeURIComponent(request.threadId)}`,
        commentAiRequestId: request.id,
        commentAiOperationId: request.id,
        commentAiAttemptId: args.attemptId,
        agentThreadId: request.agentThreadId,
        runId: request.runId,
        model: request.model,
      };
      // A Content suggestion holds exactly one edit, so separate changes become
      // one proposal. The receipt links its first edit.
      const suggestion =
        operations.length === 1
          ? await createSuggestion.run(
              {
                ...proposal,
                idempotencyKey: `comment-ai:${request.id}:suggestion`,
                operations,
                metadata,
              },
              ctx,
            )
          : (
              await createSuggestionProposal.run(
                {
                  ...proposal,
                  idempotencyKey: `comment-ai:${request.id}:proposal`,
                  suggestions: operations.map((operation) => ({
                    summary: markdownSuggestionOperationSummary(operation),
                    operations: [{ ...operation, ordinal: 0 }],
                    metadata,
                  })),
                },
                ctx,
              )
            ).suggestions[0]!;
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

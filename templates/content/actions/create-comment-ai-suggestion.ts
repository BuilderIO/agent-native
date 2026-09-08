import { defineAction } from "@agent-native/core/action";
import createSuggestion from "@agent-native/core/review/suggestions/actions/create-resource-suggestion";
import { z } from "zod";

import { markdownSuggestionOperation } from "../app/components/editor/suggestions/markdown-operation.js";
import {
  assertCommentAiSourceUnchanged,
  requireCommentAiRequest,
  retainCommentAiPayload,
  serializeCommentAiRequest,
  updateCommentAiRequest,
} from "../server/lib/comment-ai.js";
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "../server/lib/suggested-edits.js";
import { resolveDocumentTextEdits } from "../shared/document-text-edits.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";
import addComment from "./add-comment.js";

const payloadSchema = z.object({
  summary: z.string().trim().min(1).max(500),
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
export default defineAction({
  description:
    "Create one real anchored suggestion with Accept/Reject controls, linked to the original feedback. Provide one independently reviewable exact replacement. This leaves canonical text and original comment resolution unchanged.",
  schema: payloadSchema,
  run: async (args, ctx) => {
    const request = await requireCommentAiRequest("suggest");
    if (request.status === "suggested")
      return serializeCommentAiRequest(request);
    try {
      const { document } = await assertCommentAiSourceUnchanged(request);
      let retained: typeof args & {
        operation: NonNullable<ReturnType<typeof markdownSuggestionOperation>>;
      };
      if (request.payloadJson) {
        retained = JSON.parse(request.payloadJson) as typeof retained;
        if (!retained.operation)
          throw new Error("The retained proposal operation is unavailable");
      } else {
        if (
          documentRevisionToken(document.bodyRevision, document.content) !==
          request.baseRevision
        )
          throw new Error("The Page changed before this proposal was created");
        const proposed = resolveDocumentTextEdits(document.content, [
          { find: args.find, replace: args.replace },
        ]);
        if (!proposed.ok)
          throw new Error(
            `The proposal target is ${proposed.error.kind}; no suggestion was created`,
          );
        const operation = markdownSuggestionOperation(
          document.content,
          proposed.content,
        );
        if (!operation)
          throw new Error("The proposal must change the selected text");
        retained = await retainCommentAiPayload(request, {
          ...args,
          operation,
        });
      }
      const payload = payloadSchema.parse(retained);
      const suggestion = await createSuggestion.run(
        {
          resourceType: "document",
          resourceId: request.documentId,
          adapterKind: CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
          baseRevision: request.suggestionRevision,
          summary: payload.summary,
          idempotencyKey: `comment-ai:${request.id}:suggestion`,
          operations: [retained.operation],
          metadata: {
            sourceCommentId: request.rootCommentId,
            sourceThreadId: request.threadId,
            sourceUrl: `/page/${encodeURIComponent(request.documentId)}?comment=${encodeURIComponent(request.threadId)}`,
            commentAiRequestId: request.id,
          },
        },
        ctx,
      );
      await updateCommentAiRequest(request, {
        status: "running",
        result: { suggestionId: suggestion.id },
      });
      const reply = await addComment.run(
        {
          documentId: request.documentId,
          threadId: request.threadId,
          parentId: request.rootCommentId,
          content: `[${payload.summary.replace(/[\[\]]/g, "")}](/page/${encodeURIComponent(request.documentId)}?suggestion=${encodeURIComponent(suggestion.id)})`,
          idempotencyKey: `comment-ai:${request.id}:receipt`,
        },
        ctx,
      );
      return await updateCommentAiRequest(request, {
        status: "suggested",
        result: { suggestionId: suggestion.id, commentId: reply.id },
      });
    } catch (error) {
      await updateCommentAiRequest(request, {
        status: "needs-review",
        error:
          error instanceof Error
            ? error.message
            : "The proposal could not be completed",
      });
      throw error;
    }
  },
});

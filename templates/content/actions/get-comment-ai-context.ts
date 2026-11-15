import { defineAction } from "@agent-native/core/action";
import listSuggestions from "@agent-native/core/review/suggestions/actions/list-resource-suggestions";
import { z } from "zod";

import {
  beginCommentAiAttempt,
  requireCommentAiRequest,
  serializeCommentAiRequest,
} from "../server/lib/comment-ai.js";
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "../server/lib/suggested-edits.js";
import { CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER } from "../shared/blocks-field-suggestions.js";

const CONTENT_SUGGESTION_ADAPTERS = new Set([
  CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
  CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
]);

export default defineAction({
  description:
    "Read the text the comment is on (the Page body, or the Blocks field tab named in `field`) and the exact submitted comment conversation before acting. This starts or resumes a bounded reasoning attempt. If a prior action reports refreshRequired, call this again and reason from this new attempt before publishing.",
  schema: z.object({}),
  run: async (_args, ctx) => {
    const request = await requireCommentAiRequest();
    const receipt = serializeCommentAiRequest(request);
    if (["replied", "suggested", "resolved"].includes(request.status)) {
      return { request: receipt, operationCompleted: true, nextAction: null };
    }
    const {
      request: currentRequest,
      attempt,
      source,
    } = await beginCommentAiAttempt(request);
    if (!attempt) {
      return {
        request: serializeCommentAiRequest(currentRequest),
        operationCompleted: true,
        nextAction: null,
      };
    }
    const { suggestions } = await listSuggestions.run(
      { resourceType: "document", resourceId: request.documentId },
      ctx,
    );
    return {
      request: serializeCommentAiRequest(currentRequest),
      operationCompleted: false,
      nextAction: {
        reply: "reply-to-comment-ai-request",
        suggest: "create-comment-ai-suggestion",
        "apply-resolve": "apply-comment-ai-request",
      }[request.intent],
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      fieldId: request.fieldId,
      // A thread in a Blocks field tab is about that tab's text, which
      // `content` holds in place of the body's.
      field:
        source.text.fieldId === "body"
          ? null
          : { fieldId: source.text.fieldId, fieldName: source.text.fieldName },
      title: source.document.title,
      content: source.text.content,
      baseRevision: attempt.sourceRevision,
      quotedText: source.root.quotedText,
      // A thread on a Property value names it, with the value it had then
      // (none for relation, rollup, and formula Properties).
      property: source.root.propertyId
        ? {
            propertyId: source.root.propertyId,
            propertyName: source.root.propertyName,
            propertyValue: source.root.propertyValue,
          }
        : null,
      // A thread on a whole block, such as a video, quotes no text; this is
      // the block it is on.
      block: source.root.blockId
        ? { blockId: source.root.blockId, blockType: source.root.blockType }
        : null,
      conversation: source.comments.map((comment) => ({
        id: comment.id,
        parentId: comment.parentId,
        content: comment.content,
        submissionSource: comment.submissionSource,
        authorModel: comment.authorModel,
        author: comment.authorName,
      })),
      submittedConversation: JSON.parse(
        request.submittedSnapshotJson ?? request.snapshotJson,
      ),
      priorSuggestions: suggestions
        .filter(
          (suggestion) =>
            CONTENT_SUGGESTION_ADAPTERS.has(suggestion.adapterKind) &&
            suggestion.metadata?.sourceThreadId === request.threadId &&
            suggestion.metadata?.commentAiRequestId !== request.id,
        )
        .map((suggestion) => ({
          id: suggestion.id,
          status: suggestion.status,
          summary: suggestion.summary,
          urlPath: `/page/${encodeURIComponent(request.documentId)}?suggestion=${encodeURIComponent(suggestion.id)}`,
          commentAiRequestId: suggestion.metadata?.commentAiRequestId,
        })),
      retainedOperation:
        attempt.payloadJson === null ? null : JSON.parse(attempt.payloadJson),
    };
  },
});

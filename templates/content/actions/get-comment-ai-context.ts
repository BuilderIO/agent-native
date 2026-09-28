import { defineAction } from "@agent-native/core/action";
import listSuggestions from "@agent-native/core/review/suggestions/actions/list-resource-suggestions";
import { z } from "zod";

import {
  beginCommentAiAttempt,
  requireCommentAiRequest,
  serializeCommentAiRequest,
} from "../server/lib/comment-ai.js";
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "../server/lib/suggested-edits.js";

export default defineAction({
  description:
    "Read the current Page and exact submitted comment conversation before acting. This starts or resumes a bounded reasoning attempt. If a prior action reports refreshRequired, call this again and reason from this new attempt before publishing.",
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
      title: source.document.title,
      content: source.document.content,
      baseRevision: attempt.sourceRevision,
      quotedText: source.root.quotedText,
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
            suggestion.adapterKind === CONTENT_DOCUMENT_SUGGESTION_ADAPTER &&
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

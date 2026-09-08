import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  assertCommentAiSourceUnchanged,
  requireCommentAiRequest,
  serializeCommentAiRequest,
  updateCommentAiRequest,
} from "../server/lib/comment-ai.js";
import { documentRevisionToken } from "./_document-edit-mutation.js";

export default defineAction({
  description:
    "Read the exact comment conversation, submitted snapshot, Page body and revision for this scoped request. Read this before the dedicated operation. An existing result is durable; do not duplicate it.",
  schema: z.object({}),
  run: async () => {
    const request = await requireCommentAiRequest();
    const receipt = serializeCommentAiRequest(request);
    if (["replied", "suggested", "resolved"].includes(request.status))
      return { request: receipt, operationCompleted: true, nextAction: null };
    try {
      const { document, comments, root } =
        await assertCommentAiSourceUnchanged(request);
      if (
        !request.payloadJson &&
        documentRevisionToken(document.bodyRevision, document.content) !==
          request.baseRevision
      )
        throw new Error(
          "The Page changed after this comment request was submitted. Start a fresh request to use the new revision.",
        );
      await updateCommentAiRequest(request, { status: "running" });
      return {
        request: receipt,
        operationCompleted: false,
        nextAction: {
          reply: "reply-to-comment-ai-request",
          suggest: "create-comment-ai-suggestion",
          "apply-resolve": "apply-comment-ai-request",
        }[request.intent],
        fieldId: request.fieldId,
        title: document.title,
        content: document.content,
        baseRevision: request.baseRevision,
        quotedText: root.quotedText,
        conversation: comments.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          content: c.content,
          actorKind: c.actorKind,
          author: c.authorName,
        })),
        submittedConversation: JSON.parse(request.snapshotJson),
        retainedOperation:
          request.payloadJson === null ? null : JSON.parse(request.payloadJson),
      };
    } catch (error) {
      await updateCommentAiRequest(request, {
        status: "needs-review",
        error:
          error instanceof Error
            ? error.message
            : "Comment context could not be read",
      });
      throw error;
    }
  },
});

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  CommentAiOperationError,
  getCommentAiConversation,
} from "../server/lib/comment-ai.js";

const errors = defineActionErrors(
  "comment_ai_conversation_unavailable",
  "comment_ai_thread_unavailable",
  "comment_ai_operation_conflict",
  "comment_ai_ancestry_limit",
);

export default defineAction({
  description:
    "Read the requester's authorized Comment AI conversation for a Page.",
  readOnly: true,
  agentTool: false,
  http: { method: "GET" },
  persistInBrowser: false,
  schema: z.object({ requestId: z.string().uuid() }),
  outputSchema: z.object({
    threadData: z.string(),
    receiptTurnIds: z.array(z.string()),
  }),
  errors,
  run: async ({ requestId }) => {
    try {
      return await getCommentAiConversation(requestId);
    } catch (error) {
      if (
        error instanceof ForbiddenError ||
        error instanceof CommentAiOperationError ||
        (error instanceof Error &&
          (error.message === "Comment AI request not found" ||
            error.message === "Sign in to use Ask AI"))
      ) {
        return errors.fail(
          "This AI conversation is unavailable",
          "comment_ai_conversation_unavailable",
          { statusCode: 404 },
        );
      }
      throw error;
    }
  },
});

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  commentAiIntentSchema,
  startCommentAiRequest,
} from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Create one durable Ask AI operation bound to an exact source comment and intent. The receipt includes a fresh isolated background session; reuse both IDs only when retrying a lost acknowledgement.",
  toolCallable: false,
  schema: z.object({
    requestId: z.string().uuid(),
    agentThreadId: z.string().min(1).max(200).optional(),
    documentId: z.string().min(1),
    threadId: z.string().min(1),
    rootCommentId: z.string().min(1),
    intent: commentAiIntentSchema,
  }),
  run: startCommentAiRequest,
});

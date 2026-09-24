import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  commentAiSubmittedModeSchema,
  startCommentAiRequest,
} from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Create one durable Ask AI operation bound to an exact source comment, submitted mode, and instructions. Auto resolves to one authorized intent before dispatch. Reuse the request ID only when retrying the exact same submission.",
  toolCallable: false,
  schema: z.object({
    requestId: z.string().uuid(),
    agentThreadId: z.string().min(1).max(200).optional(),
    documentId: z.string().min(1),
    threadId: z.string().min(1),
    rootCommentId: z.string().min(1),
    continuationOfRequestId: z.string().uuid().optional(),
    submittedMode: commentAiSubmittedModeSchema,
    instructions: z.string().trim().min(1).max(4000),
    provider: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    engine: z.string().trim().min(1).max(80).optional(),
  }),
  run: startCommentAiRequest,
});

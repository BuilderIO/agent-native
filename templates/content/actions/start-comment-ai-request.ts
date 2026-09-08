import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  commentAiIntentSchema,
  startCommentAiRequest,
} from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Bind an Ask AI request to one original comment and the user's chosen intent.",
  toolCallable: false,
  schema: z.object({
    requestId: z.string().uuid(),
    documentId: z.string().min(1),
    threadId: z.string().min(1),
    rootCommentId: z.string().min(1),
    intent: commentAiIntentSchema,
  }),
  run: startCommentAiRequest,
});

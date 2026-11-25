import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  restartCommentAiRequest,
  startCommentAiResultSchema,
} from "../server/lib/comment-ai.js";
import { commentAiChangeResource } from "../server/lib/document-change-resource.js";

export default defineAction({
  description:
    "Start a stopped Ask AI operation over in a new agent thread, from the comment discussion as it is now. The old thread can no longer act for it.",
  toolCallable: false,
  mcpTool: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  schema: z.object({
    requestId: z.string().uuid(),
    expectedUpdatedAt: z.string(),
  }),
  outputSchema: startCommentAiResultSchema,
  run: restartCommentAiRequest,
  changeResource: commentAiChangeResource,
});

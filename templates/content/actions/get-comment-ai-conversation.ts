import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCommentAiConversation } from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Read the requester's authorized Comment AI conversation for a Page.",
  readOnly: true,
  agentTool: false,
  http: { method: "GET" },
  schema: z.object({ requestId: z.string().uuid() }),
  outputSchema: z.object({ threadData: z.string() }),
  run: ({ requestId }) => getCommentAiConversation(requestId),
});

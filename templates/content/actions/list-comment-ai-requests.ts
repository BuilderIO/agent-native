import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCommentAiRequests } from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Read the current user's saved Ask AI requests and partial results for a Page.",
  readOnly: true,
  toolCallable: false,
  http: { method: "GET" },
  schema: z.object({ documentId: z.string().min(1) }),
  run: ({ documentId }) => listCommentAiRequests(documentId),
});

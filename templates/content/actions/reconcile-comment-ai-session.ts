import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { reconcileCommentAiSession } from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Persist the latest lifecycle state for one Ask AI background session. Completed runs without an operation result and cancellations after a saved edit remain reviewable rather than being reported as successful or undone.",
  toolCallable: false,
  schema: z.object({
    operationId: z.string().uuid(),
    threadId: z.string().min(1).max(200),
    turnId: z.string().min(1).max(200),
    status: z.enum([
      "queued",
      "running",
      "completed",
      "truncated",
      "errored",
      "aborted",
      "unavailable",
    ]),
    runId: z.string().min(1).max(200).optional(),
    terminalReason: z.string().max(500).optional(),
  }),
  run: reconcileCommentAiSession,
});

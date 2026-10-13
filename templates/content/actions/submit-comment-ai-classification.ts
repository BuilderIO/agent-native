import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  commentAiIntentSchema,
  submitCommentAiClassification,
} from "../server/lib/comment-ai.js";

export default defineAction({
  description:
    "Submit the finite intent selected for the exact scoped Comment AI Auto operation. This is available only to its isolated classifier session.",
  toolCallable: false,
  schema: z.object({ intent: commentAiIntentSchema }),
  run: ({ intent }) => submitCommentAiClassification(intent),
});

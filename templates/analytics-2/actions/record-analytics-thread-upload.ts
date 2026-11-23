import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { checkedThreadAdmission } from "../server/model/analytics-thread-bootstrap.js";
import { recordAnalyticsThreadUpload } from "../server/model/analytics-thread-turns.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  recordUploadInput,
  startThreadReceipt,
  pendingThreadBootstrap,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Record a private project file or a failed upload in a reserved conversation attachment slot.",
  schema: recordUploadInput,
  outputSchema: z.union([startThreadReceipt, pendingThreadBootstrap]),
  outputErrorStrategy: "strict",
  errors: threadErrors,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    checkedThreadAdmission(async () =>
      recordAnalyticsThreadUpload(
        await currentNotebookThreadScope(context),
        input,
      ),
    ),
});

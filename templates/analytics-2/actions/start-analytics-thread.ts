import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  startAnalyticsThread,
  threadErrors,
} from "../server/model/analytics-thread-actions.js";
import { checkedThreadAdmission } from "../server/model/analytics-thread-bootstrap.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  startThreadInput,
  startThreadReceipt,
  pendingThreadBootstrap,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Start a data conversation on submission or reserve it for private attachments. Reuse the intent ID on retry.",
  schema: startThreadInput,
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
      startAnalyticsThread(await currentNotebookThreadScope(context), input),
    ),
});

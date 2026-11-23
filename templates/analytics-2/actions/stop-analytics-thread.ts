import { defineAction } from "@agent-native/core/action";

import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { stopAnalyticsThread } from "../server/model/analytics-thread-turns.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  stopThreadInput,
  stopThreadReceipt,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Stop the active question and remove queued questions through the specified sequence.",
  schema: stopThreadInput,
  outputSchema: stopThreadReceipt,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) =>
    stopAnalyticsThread(await currentNotebookThreadScope(context), input),
});

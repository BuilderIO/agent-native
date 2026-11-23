import { defineAction } from "@agent-native/core/action";

import { setAnalyticsThreadAccess } from "../server/model/analytics-thread-access.js";
import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  setThreadAccessInput,
  threadAccessReceipt,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Invite an active workspace member to read the data conversation or revoke an existing grant.",
  schema: setThreadAccessInput,
  outputSchema: threadAccessReceipt,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) =>
    setAnalyticsThreadAccess(await currentNotebookThreadScope(context), input),
});

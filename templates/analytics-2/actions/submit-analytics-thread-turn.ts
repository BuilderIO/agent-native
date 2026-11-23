import { defineAction } from "@agent-native/core/action";

import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { checkedThreadAdmission } from "../server/model/analytics-thread-bootstrap.js";
import { submitAnalyticsThreadTurn } from "../server/model/analytics-thread-turns.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  submitThreadTurnInput,
  threadTurnReceipt,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Queue a question on a bound data conversation. Reuse the message ID for a retry.",
  schema: submitThreadTurnInput,
  outputSchema: threadTurnReceipt,
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
      submitAnalyticsThreadTurn(
        await currentNotebookThreadScope(context),
        input,
      ),
    ),
});

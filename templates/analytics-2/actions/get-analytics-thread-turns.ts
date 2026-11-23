import { defineAction } from "@agent-native/core/action";

import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { checkedThreadAdmission } from "../server/model/analytics-thread-bootstrap.js";
import { readAnalyticsThreadTurns } from "../server/model/analytics-thread-transcript.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  readThreadTurnsInput,
  readThreadTurnsOutput,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Read ordered authorized data conversation answers, action receipts, and chart references.",
  schema: readThreadTurnsInput,
  outputSchema: readThreadTurnsOutput,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input, context) =>
    checkedThreadAdmission(async () =>
      readAnalyticsThreadTurns(
        await currentNotebookThreadScope(context),
        input,
      ),
    ),
});

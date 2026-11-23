import { defineAction } from "@agent-native/core/action";

import {
  getAnalyticsThreadBootstrap,
  threadErrors,
} from "../server/model/analytics-thread-actions.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  bootstrapInput,
  threadBootstrapRead,
} from "../shared/analytics-thread.js";

export default defineAction({
  description: "Read the saved bootstrap receipt for a conversation intent.",
  schema: bootstrapInput,
  outputSchema: threadBootstrapRead,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input, context) =>
    getAnalyticsThreadBootstrap(
      await currentNotebookThreadScope(context),
      input,
    ),
});

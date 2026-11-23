import { defineAction } from "@agent-native/core/action";

import { saveAnalyticsThreadProject } from "../server/model/analytics-thread-access.js";
import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  saveThreadProjectInput,
  saveThreadProjectReceipt,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "List the backing project of an owned data conversation in Projects and Search.",
  schema: saveThreadProjectInput,
  outputSchema: saveThreadProjectReceipt,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    saveAnalyticsThreadProject(
      await currentNotebookThreadScope(context),
      input,
    ),
});

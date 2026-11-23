import { defineAction } from "@agent-native/core/action";

import { listAnalyticsThreadAccess } from "../server/model/analytics-thread-access.js";
import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  listThreadAccessInput,
  threadAccessList,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "List the active members invited to read this data conversation.",
  schema: listThreadAccessInput,
  outputSchema: threadAccessList,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input, context) =>
    listAnalyticsThreadAccess(await currentNotebookThreadScope(context), input),
});

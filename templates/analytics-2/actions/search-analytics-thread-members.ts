import { defineAction } from "@agent-native/core/action";

import { searchAnalyticsThreadMembers } from "../server/model/analytics-thread-access.js";
import { threadErrors } from "../server/model/analytics-thread-actions.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  searchThreadMembersInput,
  searchThreadMembersOutput,
} from "../shared/analytics-thread.js";

export default defineAction({
  description:
    "Find members eligible for a data conversation invitation by name or email.",
  schema: searchThreadMembersInput,
  outputSchema: searchThreadMembersOutput,
  outputErrorStrategy: "strict",
  errors: threadErrors,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input, context) =>
    searchAnalyticsThreadMembers(
      await currentNotebookThreadScope(context),
      input,
    ),
});

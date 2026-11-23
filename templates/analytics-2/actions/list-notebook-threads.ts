import { defineAction, defineActionErrors } from "@agent-native/core/action";

import {
  currentNotebookThreadScope,
  listNotebookThreads,
} from "../server/model/thread-projects.js";
import {
  notebookThreadInputSchema,
  notebookThreadListSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  mcpTool: true,
  description:
    "List conversations you can use to review changes to this notebook draft.",
  schema: notebookThreadInputSchema.pick({ projectId: true }),
  outputSchema: notebookThreadListSchema,
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  errors: defineActionErrors("project_not_found"),
  run: async ({ projectId }, context) =>
    listNotebookThreads(await currentNotebookThreadScope(context), projectId),
});

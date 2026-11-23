import { defineAction } from "@agent-native/core/action";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { listNotebookHistory } from "../server/model/notebook-operations/history.js";
import {
  notebookHistoryInputSchema,
  notebookHistoryReadSchema,
} from "../shared/notebook-history.js";

export default defineAction({
  description:
    "List committed notebook changes and saved versions in newest-first pages.",
  schema: notebookHistoryInputSchema,
  outputSchema: notebookHistoryReadSchema,
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (input) =>
    listNotebookHistory(await requireCurrentWorkspace(), input),
});

import { defineAction } from "@agent-native/core/action";

import { notebookChangeResource } from "../server/lib/project-action-access.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { queryNotebookTable } from "../server/model/notebook-table-query.js";
import {
  queryNotebookTableInputSchema,
  queryNotebookTableReceiptSchema,
} from "../shared/notebook-table-query.js";

export default defineAction({
  description:
    "Add and run one SQL cell for a verified warehouse table with a 100-row limit. Use the table reference from get-notebook-table-reference with the current notebook snapshot. Replay the same request ID and input to recover the original admission.",
  schema: queryNotebookTableInputSchema,
  outputSchema: queryNotebookTableReceiptSchema,
  outputErrorStrategy: "strict",
  changeResource: notebookChangeResource,
  retrySafe: true,
  uiOnly: true,
  http: { method: "POST" },
  run: async (input, context) =>
    queryNotebookTable(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
      Boolean(context?.requestHeaders || context?.runId),
    ),
});

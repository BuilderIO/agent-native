import { defineAction } from "@agent-native/core/action";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readNotebookOperation } from "../server/model/notebook-operations/store.js";
import { requireTableQuerySource } from "../server/model/notebook-table-query.js";
import {
  notebookOperationInputSchema,
  notebookOperationReadSchema,
} from "../shared/notebook-operations.js";

export default defineAction({
  description:
    "Read the receipt for a notebook operation submitted by this account.",
  schema: notebookOperationInputSchema,
  outputSchema: notebookOperationReadSchema,
  outputErrorStrategy: "strict",
  readOnly: true,
  http: { method: "GET" },
  run: async ({ projectId, opId }, context) => {
    const scope = await requireCurrentWorkspace();
    const state = await readNotebookOperation(scope, projectId, opId);
    if (
      state.status === "found" &&
      state.receipt.status === "applied" &&
      state.receipt.tableRun
    )
      await requireTableQuerySource(
        { ...scope, caller: context?.caller ?? "unknown" },
        state.receipt.tableRun.sourceId,
        async () => {},
      );
    return state;
  },
});

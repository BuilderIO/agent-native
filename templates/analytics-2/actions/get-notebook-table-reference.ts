import { defineAction } from "@agent-native/core/action";

import { getDataTableDetailsSchema } from "../app/lib/model/data-table-contracts.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { readNotebookTableReference } from "../server/model/notebook-table-query.js";
import { warehouseTableProvenanceSchema } from "../shared/warehouse-table.js";

export default defineAction({
  description:
    "Resolve a browsable table ID on its selected source to a current catalog and access revision for notebook queries.",
  schema: getDataTableDetailsSchema,
  outputSchema: warehouseTableProvenanceSchema,
  readOnly: true,
  http: { method: "GET" },
  run: async (input, context) =>
    readNotebookTableReference(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});

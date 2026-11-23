import { defineAction } from "@agent-native/core/action";

import {
  dataTableDetailsSchema,
  getDataTableDetailsSchema,
} from "../app/lib/model/data-table-contracts.js";
import { getDataTableDetails } from "../server/model/data-table-details.js";

export default defineAction({
  description:
    "Read one table's public schema metadata (identity, columns and nested fields, types, mode, description, and counts) from a granted workspace BigQuery connection or the built-in demo source. Use the opaque table id returned by list-connection-datasets. This reads no rows and accepts no SQL.",
  schema: getDataTableDetailsSchema,
  outputSchema: dataTableDetailsSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (input, context) => getDataTableDetails(input, context?.caller),
});

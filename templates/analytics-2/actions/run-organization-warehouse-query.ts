import { defineAction } from "@agent-native/core/action";

import {
  runOrganizationWarehouseQuery,
  organizationWarehouseQueryErrors,
  organizationWarehouseQueryToolAvailable,
} from "../server/lib/organization-warehouse-query.js";
import {
  organizationWarehouseQueryInputSchema,
  organizationWarehouseQueryOutputSchema,
} from "../shared/organization-warehouse-query-contract.js";

const action = defineAction({
  description:
    "Run read-only SQL on the configured virtual organization BigQuery source, or consume its one-time poll/page continuation. Read-only SELECTs needed for the question are already authorized: run without asking permission. When hasMore is true the rows are a first-N preview, not a representative sample: never infer absence, extremes, or grain from them; use SQL aggregates instead. For a saved warehouse ID, use add-project-cell with dataConnectionId.",
  schema: organizationWarehouseQueryInputSchema,
  errors: organizationWarehouseQueryErrors,
  outputSchema: organizationWarehouseQueryOutputSchema,
  http: { method: "POST" },
  readOnly: true,
  retrySafe: false,
  planMode: { effect: "read" },
  audit: {
    recordInputs: false,
    target: () => ({
      type: "provider-api",
      id: "bigquery",
      visibility: "private",
    }),
    summary: () => "Ran a read-only organization warehouse query.",
  },
  run: runOrganizationWarehouseQuery,
});

export default Object.assign(action, {
  agentDiscoveryAvailable: organizationWarehouseQueryToolAvailable,
});

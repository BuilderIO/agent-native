import { defineAction } from "@agent-native/core/action";

import {
  recoverOrganizationWarehouseQuery,
  organizationWarehouseQueryErrors,
  organizationWarehouseQueryToolAvailable,
} from "../server/lib/organization-warehouse-query.js";
import {
  recoverOrganizationWarehouseQueryInputSchema,
  organizationWarehouseQueryOutputSchema,
} from "../shared/organization-warehouse-query-contract.js";

const action = defineAction({
  description:
    "Recover a pending query on the configured virtual organization BigQuery source. For a saved warehouse ID, read its notebook run with get-notebook-run.",
  schema: recoverOrganizationWarehouseQueryInputSchema,
  outputSchema: organizationWarehouseQueryOutputSchema,
  errors: organizationWarehouseQueryErrors,
  http: { method: "POST" },
  readOnly: true,
  retrySafe: true,
  planMode: { effect: "read" },
  audit: {
    recordInputs: false,
    target: () => ({
      type: "provider-api",
      id: "bigquery",
      visibility: "private",
    }),
    summary: () => "Recovered a pending warehouse query.",
  },
  run: recoverOrganizationWarehouseQuery,
});

export default Object.assign(action, {
  agentDiscoveryAvailable: organizationWarehouseQueryToolAvailable,
});

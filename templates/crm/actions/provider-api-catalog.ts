import { createProviderApiCatalogAction } from "@agent-native/core/provider-api/actions/provider-api";
import { z } from "zod";

import {
  CRM_PROVIDER_API_IDS,
  getCrmProviderApiRuntime,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(CRM_PROVIDER_API_IDS);

export default createProviderApiCatalogAction(getCrmProviderApiRuntime(), {
  description:
    "List the raw HubSpot and Salesforce API capabilities available through CRM's granted workspace connections. Use before provider-api-request when a CRM convenience action cannot express an endpoint, filter, custom object, pagination mode, or API version. Returns metadata and examples, never secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect: hubspot or salesforce.",
    ),
  }),
  http: { method: "GET" },
  guidance:
    "CRM actions are convenience workflows, not a provider capability limit. For an exact HubSpot or Salesforce endpoint, inspect its catalog and docs before provider-api-request. For broad work, stage a bounded paginated result, reduce it with query-staged-dataset or a data program, and report the scope, row count, pagination status, truncation, and gaps.",
});

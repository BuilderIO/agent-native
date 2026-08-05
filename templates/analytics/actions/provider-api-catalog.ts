import { createProviderApiCatalogAction } from "@agent-native/core/provider-api/actions/provider-api";
import { z } from "zod";

import {
  ANALYTICS_PROVIDER_API_IDS,
  getAnalyticsProviderApiRuntime,
} from "../server/lib/provider-api";

const ProviderSchema = z.enum(ANALYTICS_PROVIDER_API_IDS);

export default createProviderApiCatalogAction(
  getAnalyticsProviderApiRuntime(),
  {
    description:
      "List raw HTTP API capabilities for configured Analytics providers. Use before provider-api-request when canned actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, examples, and reusable corpus recipes; never returns secret values.",
    schema: z.object({
      provider: ProviderSchema.optional().describe(
        "Optional provider id to inspect. Omit to list every provider API escape hatch.",
      ),
    }),
    http: { method: "GET" },
    guidance:
      "First-class provider actions in this app are bounded convenience shortcuts, not capability limits. When an action cannot express the needed endpoint, object type, filter, request body, pagination mode, API version, or source-record body coverage, inspect docs/spec URLs and corpusRecipes here. Use provider-api-request as the raw ingestion/staging step, then query-staged-dataset or save-data-program for broad searches, joins, and reusable aggregates; use provider-corpus-job for durable paginated or batched body scans.",
  },
);

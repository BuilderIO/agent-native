import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  DISPATCH_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(DISPATCH_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for shared workspace integrations and configured providers. Use before provider-api-request when grant/setup metadata is not enough and the provider's actual API must be inspected. Returns base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect. Omit to list every provider API escape hatch.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    return {
      providers: await listProviderApiCatalog(provider),
      guidance:
        "Workspace integrations and grants are not capability limits. When a provider can answer a question through its HTTP API, inspect docs/spec URLs here and call provider-api-request with the exact provider API method/path/query/body instead of adding a rigid one-off action. For broad searches, joins, classification, or absence claims, stage or save the full bounded corpus and reduce it with query-staged-dataset or run-code.",
    };
  },
});

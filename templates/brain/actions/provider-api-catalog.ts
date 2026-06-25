import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  BRAIN_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(BRAIN_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for configured/shared providers that Brain can use for ad hoc analysis. Use before provider-api-request when source readers or canned actions are too narrow. Returns base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
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
        "Brain source sync and retrieval actions are convenience readers, not capability limits. When a question needs an endpoint, object type, filter, pagination mode, or API version that a source action does not model, inspect docs/spec URLs here and call provider-api-request with the exact provider API method/path/query/body. For broad searches, joins, classification, or absence claims, stage or save the full bounded corpus and reduce it with query-staged-dataset or run-code.",
    };
  },
});

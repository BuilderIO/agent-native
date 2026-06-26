import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  SLIDES_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(SLIDES_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for Slides-connected providers. Use before provider-api-request when deck/import convenience actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect. Omit to list every Slides provider API escape hatch.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    return {
      providers: await listProviderApiCatalog(provider),
      guidance:
        "Slides actions like import-google-doc and export-google-slides are workflow shortcuts, not capability limits. When the provider API can answer the question with a better endpoint, query, body, pagination mode, metadata field, export format, or API version, inspect docs/spec URLs and call provider-api-request directly.",
    };
  },
});

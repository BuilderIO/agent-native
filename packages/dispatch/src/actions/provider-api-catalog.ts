import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listProviderApiCatalog } from "../server/lib/provider-api.js";

export default defineAction({
  description:
    "List raw HTTP API capabilities for shared workspace integrations, configured providers, and custom registered providers. Use before provider-api-request when grant/setup metadata is not enough and the provider's actual API must be inspected. Returns base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values. Custom providers registered via provider-api-register are included.",
  schema: z.object({
    provider: z
      .string()
      .optional()
      .describe(
        "Optional provider id to inspect (built-in or custom). Omit to list every available provider API.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    const providers = await listProviderApiCatalog(provider);
    return {
      providers,
      guidance:
        "Workspace integrations and grants are not capability limits. When a provider can answer a question through its HTTP API, inspect docs/spec URLs here and call provider-api-request with the exact provider API method/path/query/body instead of adding a rigid one-off action. For broad searches, joins, classification, or absence claims, stage or save the full bounded corpus and reduce it with query-staged-dataset or run-code. Custom providers registered via provider-api-register also appear here.",
    };
  },
});

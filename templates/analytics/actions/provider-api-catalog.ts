import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  ANALYTICS_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api";

const ProviderSchema = z.enum(ANALYTICS_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for configured Analytics providers. Use before provider-api-request when canned actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
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
        "First-class provider actions in this app are convenience shortcuts, not capability limits. When an action cannot express the needed endpoint, object type, filter, request body, pagination mode, or API version, inspect docs/spec URLs here and call provider-api-request with the exact provider API method/path/query/body.",
    };
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  CALENDAR_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(CALENDAR_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for Calendar-connected providers. Use before provider-api-request when calendar/event/CRM convenience actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect. Omit to list every Calendar provider API escape hatch.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    return {
      providers: await listProviderApiCatalog(provider),
      guidance:
        "Calendar actions like list-events, search-events, and CRM contact lookups are convenience shortcuts, not capability limits. When the provider API can answer the question with a better endpoint, query, body, pagination mode, or API version, inspect docs/spec URLs and call provider-api-request directly.",
    };
  },
});

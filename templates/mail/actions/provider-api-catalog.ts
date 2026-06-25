import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  MAIL_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(MAIL_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for Mail-connected providers. Use before provider-api-request when mail/calendar/CRM convenience actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect. Omit to list every Mail provider API escape hatch.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    return {
      providers: await listProviderApiCatalog(provider),
      guidance:
        "Mail actions like search-emails, list-emails, get-thread, Gmail filters, calendar RSVP, and HubSpot lookups are convenience shortcuts, not capability limits. When the provider API can answer the question with a better endpoint, query, body, pagination mode, or API version, inspect docs/spec URLs and call provider-api-request directly.",
    };
  },
});

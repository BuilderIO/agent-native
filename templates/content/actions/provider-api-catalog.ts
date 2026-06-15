import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  CONTENT_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(CONTENT_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for Content-connected providers. Use before provider-api-request when Notion convenience actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect. Omit to list every Content provider API escape hatch.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    return {
      providers: await listProviderApiCatalog(provider),
      guidance:
        "Content actions like pull-notion-page, push-notion-page, sync-notion-comments, and link-notion-page are workflow shortcuts, not capability limits. When the Notion API can answer the question with a better endpoint, query, body, pagination mode, or API version, inspect docs/spec URLs and call provider-api-request directly with the user's OAuth connection. The built-in catalog may name NOTION_API_KEY as the generic bearer slot; Content intentionally resolves that slot from the user's per-user Notion OAuth token instead of env/user-entered API keys.",
    };
  },
});

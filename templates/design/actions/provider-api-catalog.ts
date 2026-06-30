import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  DESIGN_PROVIDER_API_IDS,
  listProviderApiCatalog,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(DESIGN_PROVIDER_API_IDS);

export default defineAction({
  description:
    "List raw HTTP API capabilities for Design-connected providers such as GitHub and Figma. Use before provider-api-request when design-token, repository, or Figma-library convenience actions are too narrow. Returns provider base URLs, auth style, credential key names, docs/spec URLs, placeholders, and examples; never returns secret values.",
  schema: z.object({
    provider: ProviderSchema.optional().describe(
      "Optional provider id to inspect. Omit to list every Design provider API escape hatch.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider }) => {
    return {
      providers: await listProviderApiCatalog(provider),
      guidance:
        "Design actions like import-github and list-figma-library-assets are workflow shortcuts, not capability limits. When GitHub or Figma can answer the question with a better endpoint, query, body, pagination mode, metadata field, or API version, inspect docs/spec URLs and call provider-api-request directly. Auth uses saved scoped secrets such as GITHUB_TOKEN or FIGMA_ACCESS_TOKEN and never exposes token values.",
    };
  },
});

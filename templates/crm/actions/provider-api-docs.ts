import { createProviderApiDocsAction } from "@agent-native/core/provider-api/actions/provider-api";
import { z } from "zod";

import {
  CRM_PROVIDER_API_IDS,
  getCrmProviderApiRuntime,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(CRM_PROVIDER_API_IDS);
const BooleanFromQuerySchema = z.preprocess(
  (value) => (typeof value === "string" ? value === "true" : value),
  z.boolean(),
);

export default createProviderApiDocsAction(getCrmProviderApiRuntime(), {
  description:
    "Inspect HubSpot API documentation before an exact provider-api-request when the endpoint, object schema, property, filter operator, association, or pagination contract is uncertain.",
  schema: z.object({
    provider: ProviderSchema.describe("Provider whose API docs to inspect."),
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional public HubSpot docs/spec URL. The provider catalog returns curated starting URLs.",
      ),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(4 * 1024 * 1024)
      .optional(),
    maxChars: z.coerce.number().int().min(1).max(200_000).optional(),
    responseMode: z
      .enum(["auto", "raw", "text", "markdown", "links", "metadata", "matches"])
      .optional(),
    extract: z.enum(["readability", "all-visible", "none"]).optional(),
    includeLinks: BooleanFromQuerySchema.optional(),
    search: z
      .object({
        query: z.union([z.string(), z.array(z.string())]).optional(),
        queries: z.array(z.string()).optional(),
        terms: z.array(z.string()).optional(),
        regex: z.string().optional(),
        regexFlags: z.string().optional(),
        source: z.enum(["extracted", "raw"]).optional(),
        maxMatches: z.coerce.number().int().min(1).max(500).optional(),
        contextChars: z.coerce.number().int().min(0).max(1_000).optional(),
        caseSensitive: BooleanFromQuerySchema.optional(),
      })
      .optional(),
  }),
  http: { method: "GET" },
});

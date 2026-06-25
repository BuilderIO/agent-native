import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  MAIL_PROVIDER_API_IDS,
  fetchProviderApiDocs,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(MAIL_PROVIDER_API_IDS);
const BooleanFromQuerySchema = z.preprocess(
  (value) => (typeof value === "string" ? value === "true" : value),
  z.boolean(),
);
const WebContentSearchSchema = z.object({
  query: z.union([z.string(), z.array(z.string())]).optional(),
  queries: z.array(z.string()).optional(),
  terms: z.array(z.string()).optional(),
  regex: z.string().optional(),
  regexFlags: z.string().optional(),
  source: z.enum(["extracted", "raw"]).optional(),
  maxMatches: z.coerce.number().int().min(1).max(500).optional(),
  contextChars: z.coerce.number().int().min(0).max(1_000).optional(),
  caseSensitive: BooleanFromQuerySchema.optional(),
});

export default defineAction({
  description:
    "Inspect provider API docs/spec metadata, or fetch any public API documentation page, OpenAPI spec, changelog, or web page. Use this before provider-api-request when the exact Gmail, Google Calendar, or CRM endpoint, filter operator, payload shape, pagination, or API version is uncertain.",
  schema: z.object({
    provider: ProviderSchema.describe(
      "Provider whose API docs/spec to inspect.",
    ),
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional public docs/spec URL to fetch. Registered docs/spec URLs from provider-api-catalog are curated starting points, but any public http(s) API documentation URL is allowed.",
      ),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(4 * 1024 * 1024)
      .optional()
      .describe("Maximum response bytes to read. Default 1MB, max 4MB."),
    maxChars: z.coerce
      .number()
      .int()
      .min(1)
      .max(200_000)
      .optional()
      .describe("Maximum extracted content characters to return."),
    responseMode: z
      .enum(["auto", "raw", "text", "markdown", "links", "metadata", "matches"])
      .optional()
      .describe(
        "How to return fetched docs. Default auto extracts HTML to markdown; use matches with search for compact snippets.",
      ),
    extract: z
      .enum(["readability", "all-visible", "none"])
      .optional()
      .describe("HTML extraction strategy. Default readability."),
    includeLinks: BooleanFromQuerySchema.optional().describe(
      "Include compact links from extracted HTML. Default true.",
    ),
    search: WebContentSearchSchema.optional().describe(
      "Optional post-fetch search over extracted content by default. Supports query, queries, terms, regex, source, maxMatches, and contextChars.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => fetchProviderApiDocs(args),
});

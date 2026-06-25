import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { fetchProviderApiDocs } from "../server/lib/provider-api.js";

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
    "Inspect provider API docs/spec metadata, or fetch ANY public API documentation page, OpenAPI spec, changelog, or web page. Registered docs/spec URLs from provider-api-catalog are curated starting points, but any public https/http URL is allowed. Use web-search to find documentation URLs first when uncertain, then fetch them here. SSRF guard still applies — private/internal addresses are blocked.",
  schema: z.object({
    provider: z
      .string()
      .min(1)
      .describe(
        "Provider whose API docs/spec to inspect. Can be a built-in provider id or a custom provider id registered via provider-api-register.",
      ),
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional URL to fetch. Can be any public https/http URL — API documentation pages, OpenAPI specs, changelogs, README files, etc. Registered docs/spec URLs from provider-api-catalog are curated starting points.",
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

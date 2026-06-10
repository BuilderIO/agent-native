import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchProviderApiDocs } from "../server/lib/provider-api.js";

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
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => fetchProviderApiDocs(args),
});

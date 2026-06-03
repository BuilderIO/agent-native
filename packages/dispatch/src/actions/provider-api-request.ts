import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  DISPATCH_PROVIDER_API_IDS,
  executeProviderApiRequest,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(DISPATCH_PROVIDER_API_IDS);
const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

export default defineAction({
  description:
    "Make an arbitrary authenticated HTTP request to a shared workspace integration or configured provider API. Use this as the flexible escape hatch when Dispatch needs a provider endpoint, filter, pagination mode, payload, or API version that no canned action models. The request is constrained to the provider host, uses configured credentials automatically, blocks private/internal URLs, and redacts secrets from responses.",
  schema: z.object({
    provider: ProviderSchema.describe(
      "Configured provider API to call, e.g. slack, github, notion, hubspot, gmail, google_drive, google_calendar, granola, stripe, jira.",
    ),
    method: MethodSchema.default("GET").describe("HTTP method to use."),
    path: z
      .string()
      .min(1)
      .describe(
        "Provider API path such as /search.messages, /repos/org/repo/issues, /crm/v3/objects/deals/search, or a full URL on an allowed provider host. Use placeholders from provider-api-catalog when provided.",
      ),
    query: z
      .unknown()
      .optional()
      .describe(
        "Optional query params as a JSON object/string. Array values produce repeated query params.",
      ),
    headers: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Optional extra headers. Unsafe hop-by-hop headers are ignored. Auth headers are injected from stored credentials.",
      ),
    body: z
      .unknown()
      .optional()
      .describe(
        "Optional request body. Objects/arrays are JSON encoded; strings are sent as-is.",
      ),
    auth: z
      .enum(["default", "none"])
      .default("default")
      .describe(
        "Use default to inject configured provider auth. Use none only for public provider endpoints that intentionally require no auth.",
      ),
    connectionId: z
      .string()
      .optional()
      .describe(
        "Optional shared workspace connection id to use when the provider has multiple granted connections.",
      ),
    accountId: z
      .string()
      .optional()
      .describe(
        "Optional OAuth account id to use for OAuth-backed providers such as Gmail, Google Calendar, or Google Drive.",
      ),
    timeoutMs: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .optional()
      .describe("Request timeout in milliseconds. Default 30000, max 120000."),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(4 * 1024 * 1024)
      .optional()
      .describe("Maximum response bytes to read. Default 1MB, max 4MB."),
  }),
  http: false,
  run: async (args) => executeProviderApiRequest(args),
});

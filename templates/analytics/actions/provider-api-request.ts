import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  ANALYTICS_PROVIDER_API_IDS,
  executeProviderApiRequest,
} from "../server/lib/provider-api";

const ProviderSchema = z.enum(ANALYTICS_PROVIDER_API_IDS);
const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

export default defineAction({
  description:
    "Make an arbitrary authenticated HTTP request to a configured Analytics provider API. Use this as the flexible escape hatch when a canned integration action cannot express the needed endpoint, filters, pagination, payload, or API version. The request is constrained to the provider host, uses configured credentials automatically, blocks private/internal URLs, and redacts secrets from responses.",
  schema: z.object({
    provider: ProviderSchema.describe(
      "Configured provider API to call, e.g. hubspot, gong, slack, stripe, jira, bigquery, ga4, gcloud, grafana, sentry.",
    ),
    method: MethodSchema.default("GET").describe("HTTP method to use."),
    path: z
      .string()
      .min(1)
      .describe(
        "Provider API path such as /crm/v3/objects/deals/search, or a full URL on an allowed provider host. Use placeholders from provider-api-catalog such as {projectId}, {propertyId}, or {orgSlug}.",
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
      .trim()
      .min(1)
      .optional()
      .describe(
        "Optional workspace connection ID to use for provider credentials. When set, credentials must resolve from that connection.",
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
      .describe(
        "Maximum response bytes to read. Default 1MB, max 4MB. Ignored when saveToFile is set (allows up to 20MB).",
      ),
    saveToFile: z
      .string()
      .optional()
      .describe(
        "Workspace file path to save the full response body to instead of returning it in context (e.g. 'analysis/hubspot-deals.json'). When set, returns only a compact summary {savedTo, status, bytes, preview} and allows up to 20MB response. Ideal for large datasets that would overflow context.",
      ),
    fetchAllPages: z
      .object({
        cursorPath: z
          .string()
          .describe(
            "Dot-path in the JSON response body where the next-page cursor lives, e.g. 'meta.next_cursor' or 'pagination.next_page_token'.",
          ),
        cursorParam: z
          .string()
          .describe(
            "Query parameter name to pass the cursor on subsequent pages, e.g. 'cursor' or 'page_token'.",
          ),
        itemsPath: z
          .string()
          .optional()
          .describe(
            "Dot-path to the items array in each response, e.g. 'results' or 'data.items'. When omitted, the whole response body is appended per page.",
          ),
        maxPages: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Maximum pages to fetch. Default 10, max 50. Stops early when cursor is empty.",
          ),
      })
      .optional()
      .describe(
        "Enable cursor-based pagination. After each response, reads cursorPath from the JSON body and re-issues the request with cursorParam set, accumulating items from itemsPath (or whole bodies) until cursor is empty or maxPages is reached. Combine with saveToFile to write the full dataset to a workspace file.",
      ),
  }),
  http: false,
  run: async (args) => executeProviderApiRequest(args),
});

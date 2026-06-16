import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  ANALYTICS_PROVIDER_API_IDS,
  executeProviderApiRequest,
  getAnalyticsProviderApiRuntime,
} from "../server/lib/provider-api";
import { stagingExecuteRequest } from "@agent-native/core/provider-api/staging";
import { requireRequestCredentialContext } from "../server/lib/credentials-context";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

const ProviderSchema = z.enum(ANALYTICS_PROVIDER_API_IDS);
const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const PaginationSchema = z
  .object({
    nextCursorPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the response JSON where the next cursor/token lives, e.g. 'next_cursor', 'meta.next'.",
      ),
    cursorParam: z
      .string()
      .optional()
      .describe(
        "Query parameter name to inject the cursor into the next request. Use this for query-string pagination.",
      ),
    cursorBodyPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the JSON request body to set to the next cursor. Use this for POST-body pagination, e.g. Gong uses cursorBodyPath='cursor' with nextCursorPath='records.cursor'.",
      ),
    pageParam: z
      .string()
      .optional()
      .describe(
        "Use page-number mode: this query param is incremented on each page.",
      ),
    startPage: z.coerce
      .number()
      .int()
      .optional()
      .describe("Starting page number for pageParam mode (default 1)."),
    offsetParam: z
      .string()
      .optional()
      .describe(
        "Use offset mode: this query param is incremented by pageSize on each request.",
      ),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Expected page size for offset increments. Defaults to the actual item count of the first page.",
      ),
    maxPages: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum pages to fetch server-side (default 50, max 200)."),
  })
  .optional();

export default defineAction({
  description:
    "Make an arbitrary authenticated HTTP request to a configured provider API available to this app. " +
    "Use this as the flexible escape hatch when a canned integration action cannot express the needed endpoint, filters, pagination, payload, or API version. " +
    "The request is constrained to the provider host, uses configured credentials automatically, blocks private/internal URLs, and redacts secrets from responses. " +
    "\n\nSTAGING MODE (preferred for large responses): Pass stageAs to write the response items into a scratch dataset instead of returning the raw body. " +
    "Returns { dataset, rowCount, columns, sampleRows } — only a compact summary flows into the context window. " +
    "Use query-staged-dataset to aggregate, filter, and project the data without re-fetching. " +
    "\n\nPAGINATION: When stageAs is set, pass pagination config to fetch all pages server-side into the same dataset (cursor, page, or offset modes). " +
    "Handles 429/Retry-After with exponential back-off. Returns { pages, rows, truncated, lastCursor } summary. " +
    "For APIs that page through POST bodies, pass cursorBodyPath instead of cursorParam.",
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
    stageAs: z
      .string()
      .min(1)
      .optional()
      .describe(
        "When set, parse the response as an array of records and write them into a staged dataset with this name. " +
          "Returns a compact summary (rowCount, columns, sampleRows) instead of the raw body. " +
          "Re-staging the same name replaces the previous dataset. " +
          "Use query-staged-dataset to aggregate the staged data.",
      ),
    itemsPath: z
      .string()
      .optional()
      .describe(
        "Dot-path to the items array in the response JSON, e.g. 'data', 'results', 'items'. " +
          "Omit for auto-detection (handles top-level array, {data:[]}, {results:[]}, {items:[]}).",
      ),
    pagination: PaginationSchema.describe(
      "Pagination config for server-side fetchAll (only used when stageAs is set). " +
        "Supports cursor (nextCursorPath + cursorParam or cursorBodyPath), page (pageParam), and offset (offsetParam) modes.",
    ),
    saveToFile: z
      .string()
      .optional()
      .describe(
        "Workspace file path to save the full response body to instead of returning it in context (e.g. 'analysis/provider-response.json'). When set, returns only a compact summary {savedTo, status, bytes, preview} and allows up to 20MB response. Ideal for large datasets that would overflow context.",
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
          .optional()
          .describe(
            "Query parameter name to pass the cursor on subsequent pages, e.g. 'cursor' or 'page_token'. Use cursorBodyPath instead for APIs that put cursors in POST bodies.",
          ),
        cursorBodyPath: z
          .string()
          .optional()
          .describe(
            "Dot-path in the JSON request body to set to the next cursor. Use for POST-body pagination such as Gong { cursor: ... }.",
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
        "Enable cursor-based pagination. After each response, reads cursorPath from the JSON body and re-issues the request with cursorParam or cursorBodyPath set, accumulating items from itemsPath (or whole bodies) until cursor is empty or maxPages is reached. Combine with saveToFile to write the full dataset to a workspace file.",
      ),
  }),
  http: false,
  run: async (args) => {
    if (args.stageAs) {
      const ctx = requireRequestCredentialContext("provider-api staging");
      const providerRuntime = getAnalyticsProviderApiRuntime();
      return stagingExecuteRequest(
        {
          provider: args.provider,
          method: args.method,
          path: args.path,
          query: args.query,
          headers: args.headers,
          body: args.body,
          auth: args.auth,
          connectionId: args.connectionId,
          accountId: args.accountId,
          timeoutMs: args.timeoutMs,
          maxBytes: args.maxBytes,
          stageAs: args.stageAs,
          itemsPath: args.itemsPath,
          pagination: args.pagination,
        },
        (reqArgs) => providerRuntime.executeRequest(reqArgs),
        { appId: ANALYTICS_APP_ID, ownerEmail: ctx.userEmail },
      );
    }
    return executeProviderApiRequest(
      args as unknown as Parameters<typeof executeProviderApiRequest>[0],
    );
  },
});

import { defineAction } from "@agent-native/core";
import { stagingExecuteRequest } from "@agent-native/core/provider-api/staging";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  DESIGN_APP_ID,
  DESIGN_PROVIDER_API_IDS,
  executeProviderApiRequest,
  getDesignProviderApiRuntime,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(DESIGN_PROVIDER_API_IDS);
const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const PaginationSchema = z
  .object({
    nextCursorPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the response JSON where the next cursor/token lives, e.g. 'next'.",
      ),
    cursorParam: z
      .string()
      .optional()
      .describe(
        "Query parameter name to inject the cursor into the next request. Use cursorBodyPath for APIs that page through POST bodies.",
      ),
    cursorBodyPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the JSON request body to set to the next cursor. Use this for POST-body pagination.",
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
    "Make an arbitrary authenticated HTTP request to a Design-connected provider API. " +
    "Use this as the flexible escape hatch when a convenience action cannot express the needed GitHub endpoint, file tree query, issue/search query, request body, pagination mode, payload shape, or API version. " +
    "The request is constrained to the provider host, uses the saved GITHUB_TOKEN automatically, blocks private/internal URLs, and redacts secrets from responses. " +
    "\n\nSTAGING MODE (preferred for large responses): Pass stageAs to write response items into a scratch dataset instead of returning the raw body. " +
    "Returns { dataset, rowCount, columns, sampleRows } so only a compact summary enters context. Use query-staged-dataset to aggregate, filter, and project the data without re-fetching. " +
    "\n\nPAGINATION: When stageAs is set, pass pagination config to fetch all pages server-side into the same dataset. For GitHub page pagination, use pageParam='page', pageSize from per_page, and itemsPath when the response object contains an items array.",
  schema: z.object({
    provider: ProviderSchema.describe("Configured provider API to call."),
    method: MethodSchema.default("GET").describe("HTTP method to use."),
    path: z
      .string()
      .min(1)
      .describe(
        "Provider API path such as /repos/{owner}/{repo}/contents/{path}, /search/code, /issues, or a full URL on an allowed provider host. Use placeholders from provider-api-catalog when provided.",
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
      .describe("Reserved for shared workspace grants."),
    accountId: z.string().optional().describe("Reserved for OAuth providers."),
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
        "When set, parse the response as an array of records and write them into a staged dataset with this name. Returns a compact summary instead of the raw body. Re-staging the same name replaces the previous dataset.",
      ),
    itemsPath: z
      .string()
      .optional()
      .describe(
        "Dot-path to the items array in the response JSON, e.g. 'items' for GitHub search results. Omit for auto-detection.",
      ),
    pagination: PaginationSchema.describe(
      "Pagination config for server-side fetchAll when stageAs is set. Supports cursor (nextCursorPath + cursorParam or cursorBodyPath), page, and offset modes.",
    ),
    saveToFile: z
      .string()
      .optional()
      .describe(
        "Workspace file path to save the full response body to instead of returning it in context, e.g. 'design/github-search.json'. When set, returns only a compact summary and allows up to 20MB response.",
      ),
    fetchAllPages: z
      .object({
        cursorPath: z
          .string()
          .describe(
            "Dot-path in the JSON response body where the next-page cursor lives.",
          ),
        cursorParam: z
          .string()
          .optional()
          .describe(
            "Query parameter name to pass the cursor on subsequent pages. Use cursorBodyPath instead for APIs that put cursors in POST bodies.",
          ),
        cursorBodyPath: z
          .string()
          .optional()
          .describe(
            "Dot-path in the JSON request body to set to the next cursor. Use for POST-body pagination.",
          ),
        itemsPath: z
          .string()
          .optional()
          .describe(
            "Dot-path to the items array in each response. When omitted, the whole response body is appended per page.",
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
        "Enable cursor-based pagination for APIs that expose cursors. After each response, reads cursorPath and re-issues the request with cursorParam or cursorBodyPath set.",
      ),
  }),
  http: false,
  run: async (args) => {
    if (args.stageAs) {
      const ctx = getCredentialContext();
      if (!ctx) {
        throw new Error("No authenticated context for provider API staging.");
      }
      const providerRuntime = getDesignProviderApiRuntime();
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
        { appId: DESIGN_APP_ID, ownerEmail: ctx.userEmail },
      );
    }
    return executeProviderApiRequest(
      args as unknown as Parameters<typeof executeProviderApiRequest>[0],
    );
  },
});

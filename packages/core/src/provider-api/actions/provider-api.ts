import { z, type ZodTypeAny } from "zod";

import {
  defineAction,
  type ActionHttpConfig,
  type ActionRunContext,
} from "../../action.js";
import { getCredentialContext } from "../../server/request-context.js";
import type {
  ProviderApiDocsOptions,
  ProviderApiRequestArgs,
  ProviderApiRuntime,
} from "../index.js";
import { stagingExecuteRequest, type StagingRequestArgs } from "../staging.js";
import {
  createCustomProviderRegistrationAction,
  type CreateCustomProviderRegistrationActionOptions,
} from "./custom-provider-registration.js";
import { buildProviderApiAuditSummary } from "./provider-api-audit.js";

const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const PaginationSchema = z
  .object({
    nextCursorPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the response JSON where the next cursor/token lives, e.g. 'next_cursor', 'meta.next', or 'nextPageToken'.",
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

const FetchAllPagesSchema = z
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
        "Dot-path in the JSON request body to set to the next cursor. Use for POST-body pagination.",
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
        "Maximum pages to fetch. Default 10, max 50. Stops early when the cursor is empty.",
      ),
  })
  .optional()
  .describe(
    "Enable cursor-based pagination. After each response, reads cursorPath from the JSON body and re-issues the request with cursorParam or cursorBodyPath set, accumulating items from itemsPath (or whole bodies) until cursor is empty or maxPages is reached. Combine with saveToFile to write the full dataset to a workspace file.",
  );

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

export function createProviderApiRequestSchema(
  providerSchema: ZodTypeAny = z
    .string()
    .min(1)
    .describe(
      "Provider id to call — built-in or a custom provider id registered via provider-api-register. Use provider-api-catalog to list available providers.",
    ),
) {
  return z.object({
    provider: providerSchema,
    method: MethodSchema.default("GET").describe("HTTP method to use."),
    path: z
      .string()
      .min(1)
      .describe(
        "Provider API path or a full URL on an allowed provider host. Use placeholders from provider-api-catalog when provided.",
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
        "Shared workspace connection id to use when the provider has multiple granted connections. Required when provider-api-catalog marks requiresConnectionId.",
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
        "Workspace file path to save the full response body to instead of returning it in context. When set, returns a compact summary and allows up to 20MB response.",
      ),
    stageAs: z
      .string()
      .min(1)
      .optional()
      .describe(
        "When set, parse the response as records and write them into a staged dataset with this name. Re-staging the same name replaces the previous dataset.",
      ),
    itemsPath: z
      .string()
      .optional()
      .describe(
        "Dot-path to the items array in the response JSON. Omit for auto-detection.",
      ),
    pagination: PaginationSchema.describe(
      "Pagination config for server-side fetchAll when stageAs is set. Supports cursor, page, and offset modes.",
    ),
    fetchAllPages: FetchAllPagesSchema,
  });
}

export function createProviderApiCatalogSchema(
  providerSchema: ZodTypeAny = z.string(),
) {
  return z.object({
    provider: providerSchema
      .optional()
      .describe(
        "Optional provider id to inspect. Omit to list every available provider API.",
      ),
  });
}

export function createProviderApiDocsSchema(
  providerSchema: ZodTypeAny = z.string().min(1),
) {
  return z.object({
    provider: providerSchema.describe(
      "Provider whose API docs/spec to inspect.",
    ),
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional public documentation, OpenAPI spec, changelog, or web page URL to fetch.",
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
  });
}

type ProviderRequestActionArgs = StagingRequestArgs & {
  saveToFile?: string;
  fetchAllPages?: ProviderApiRequestArgs["fetchAllPages"];
};

interface ProviderApiActionBaseOptions<TSchema extends ZodTypeAny> {
  schema?: TSchema;
  description?: string;
  http?: ActionHttpConfig | false;
  toolCallable?: boolean;
}

export interface CreateProviderApiRequestActionOptions<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createProviderApiRequestSchema
  >,
> extends ProviderApiActionBaseOptions<TSchema> {
  appId?: string;
  getOwnerEmail?: () => string | null;
  needsApproval?:
    | boolean
    | ((
        args: z.output<TSchema>,
        ctx?: ActionRunContext,
      ) => boolean | Promise<boolean>);
}

export function createProviderApiRequestAction<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createProviderApiRequestSchema
  >,
>(
  runtime: Pick<ProviderApiRuntime, "executeRequest">,
  options: CreateProviderApiRequestActionOptions<TSchema> = {},
) {
  const schema = options.schema ?? createProviderApiRequestSchema();
  return defineAction({
    description:
      options.description ??
      "Make an arbitrary authenticated HTTP request to a shared workspace integration, configured provider API, or custom provider registered via provider-api-register. Use this flexible escape hatch when a provider endpoint, filter, pagination mode, payload, or API version is not covered by a first-class action. Requests stay constrained to allowed provider hosts and credentials are injected by the provider runtime.",
    schema,
    http: options.http ?? false,
    ...(options.toolCallable === undefined
      ? {}
      : { toolCallable: options.toolCallable }),
    ...(options.needsApproval === undefined
      ? {}
      : {
          needsApproval: options.needsApproval as
            | boolean
            | ((
                args: unknown,
                ctx?: ActionRunContext,
              ) => boolean | Promise<boolean>),
        }),
    audit: {
      recordInputs: false,
      target: (args) => ({
        type: "provider-api",
        id: String((args as ProviderRequestActionArgs).provider),
        visibility: "private" as const,
      }),
      summary: (args) =>
        buildProviderApiAuditSummary(args as ProviderRequestActionArgs),
    },
    run: async (rawArgs) => {
      const args = rawArgs as ProviderRequestActionArgs;
      if (args.stageAs) {
        if (!options.appId) {
          throw new Error(
            "createProviderApiRequestAction requires appId when stageAs is used.",
          );
        }
        const ownerEmail = options.getOwnerEmail
          ? options.getOwnerEmail()
          : (getCredentialContext()?.userEmail ?? null);
        if (!ownerEmail) {
          throw new Error("No authenticated context for provider API staging.");
        }
        return stagingExecuteRequest(args, runtime.executeRequest, {
          appId: options.appId,
          ownerEmail,
        });
      }
      return runtime.executeRequest(args);
    },
  });
}

export interface CreateProviderApiCatalogActionOptions<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createProviderApiCatalogSchema
  >,
> extends ProviderApiActionBaseOptions<TSchema> {
  guidance?: string;
}

export function createProviderApiCatalogAction<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createProviderApiCatalogSchema
  >,
>(
  runtime: Pick<ProviderApiRuntime, "listCatalog">,
  options: CreateProviderApiCatalogActionOptions<TSchema> = {},
) {
  const schema = options.schema ?? createProviderApiCatalogSchema();
  return defineAction({
    description:
      options.description ??
      "List raw HTTP API capabilities for shared workspace integrations, configured providers, and custom registered providers. Returns setup metadata and examples, never secret values.",
    schema,
    http: options.http ?? { method: "GET" },
    readOnly: true,
    run: async (rawArgs) => {
      const args = rawArgs as { provider?: string };
      return {
        providers: await runtime.listCatalog(args.provider),
        guidance:
          options.guidance ??
          "First-class provider actions are convenience shortcuts, not capability limits. Inspect provider docs and use provider-api-request when the upstream API can express the operation safely.",
      };
    },
  });
}

export interface CreateProviderApiDocsActionOptions<
  TSchema extends ZodTypeAny = ReturnType<typeof createProviderApiDocsSchema>,
> extends ProviderApiActionBaseOptions<TSchema> {}

export function createProviderApiDocsAction<
  TSchema extends ZodTypeAny = ReturnType<typeof createProviderApiDocsSchema>,
>(
  runtime: Pick<ProviderApiRuntime, "fetchDocs">,
  options: CreateProviderApiDocsActionOptions<TSchema> = {},
) {
  const schema = options.schema ?? createProviderApiDocsSchema();
  return defineAction({
    description:
      options.description ??
      "Inspect provider API docs/spec metadata or fetch a public API documentation page, OpenAPI spec, changelog, or web page. Private and internal addresses remain blocked by the provider runtime.",
    schema,
    http: options.http ?? { method: "GET" },
    readOnly: true,
    run: async (rawArgs) =>
      runtime.fetchDocs(rawArgs as ProviderApiDocsOptions),
  });
}

export interface CreateProviderApiActionsOptions {
  request?: CreateProviderApiRequestActionOptions;
  catalog?: CreateProviderApiCatalogActionOptions;
  docs?: CreateProviderApiDocsActionOptions;
  customProviderRegistration?: boolean;
  registration?: CreateCustomProviderRegistrationActionOptions;
}

export function createProviderApiActions(
  runtime: Pick<
    ProviderApiRuntime,
    "executeRequest" | "listCatalog" | "fetchDocs"
  >,
  options: CreateProviderApiActionsOptions = {},
) {
  return {
    request: createProviderApiRequestAction(runtime, options.request),
    catalog: createProviderApiCatalogAction(runtime, options.catalog),
    docs: createProviderApiDocsAction(runtime, options.docs),
    register: options.customProviderRegistration
      ? createCustomProviderRegistrationAction(options.registration)
      : undefined,
  };
}

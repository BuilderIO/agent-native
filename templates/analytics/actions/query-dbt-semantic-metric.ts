import {
  AgentConnectionRequiredError,
  defineAction,
  fail,
  isAgentConnectionRequiredError,
} from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionCredentialForApp,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

const LOOKUP_METRIC = `query AnalyticsMetricLookup($environmentId: BigInt!, $search: String!, $pageNum: Int!) {
  metricsPaginated(environmentId: $environmentId, search: $search, pageNum: $pageNum, pageSize: 100) {
    items { name description type dimensions { name description type queryableGranularities } queryableGranularities }
    totalItems
    totalPages
  }
}`;

const COUNT_METRICS = `query AnalyticsMetricCount($environmentId: BigInt!) {
  metricsPaginated(environmentId: $environmentId, pageNum: 1, pageSize: 1) {
    totalItems
  }
}`;

const CREATE_METRIC_QUERY = `mutation AnalyticsMetricQuery($environmentId: BigInt!, $metricName: String!, $groupBy: [GroupByInput!], $where: [WhereInput!], $queryRowCap: Int!) {
  createQuery(environmentId: $environmentId, metrics: [{ name: $metricName }], groupBy: $groupBy, where: $where, limit: $queryRowCap) {
    queryId
  }
}`;

const READ_METRIC_QUERY = `query AnalyticsMetricResult($environmentId: BigInt!, $queryId: String!, $pageNum: Int!) {
  query(environmentId: $environmentId, queryId: $queryId, pageNum: $pageNum) {
    status
    error
    totalPages
    jsonResult(orient: TABLE, encoded: false)
  }
}`;

const MAX_POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 400;
const MAX_METADATA_PAGES = 10;
const MAX_METRIC_QUERY_ROWS = 1_000;
const MAX_METRIC_QUERY_DAYS = 366;
const DBT_TIME_GRANULARITIES = [
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
] as const;
const DBT_ENVIRONMENT_FIELD = "semanticLayerEnvironmentId";
const metricConnectionSchema = z.object({ id: z.string(), label: z.string() });
const metricGroupBySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Exact dimension name returned by dbt metric metadata"),
    grain: z
      .enum(DBT_TIME_GRANULARITIES)
      .optional()
      .describe("Required for time dimensions; use a returned queryable grain"),
  })
  .strict();
const metricTimeRangeSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Inclusive start date in YYYY-MM-DD format"),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Inclusive end date in YYYY-MM-DD format"),
  })
  .strict()
  .superRefine(({ startDate, endDate }, context) => {
    const startDay = dateDayNumber(startDate);
    const endDay = dateDayNumber(endDate);
    if (startDay === null) {
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "Use a real calendar date in YYYY-MM-DD format.",
      });
    }
    if (endDay === null) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Use a real calendar date in YYYY-MM-DD format.",
      });
    }
    if (startDay !== null && endDay !== null) {
      if (endDay < startDay) {
        context.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "The end date must be on or after the start date.",
        });
      } else if (endDay - startDay + 1 > MAX_METRIC_QUERY_DAYS) {
        context.addIssue({
          code: "custom",
          path: ["endDate"],
          message: `MetricFlow date ranges are limited to ${MAX_METRIC_QUERY_DAYS} inclusive days.`,
        });
      }
    }
  });
const metricQuerySpecSchema = z
  .object({
    groupBy: z.array(metricGroupBySchema).max(5),
    timeRange: metricTimeRangeSchema.optional(),
  })
  .strict()
  .superRefine(({ groupBy, timeRange }, context) => {
    if (groupBy.length > 0 && !timeRange) {
      context.addIssue({
        code: "custom",
        path: ["timeRange"],
        message:
          "Dimension-grouped MetricFlow queries require a bounded date range.",
      });
    }
    const names = groupBy.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["groupBy"],
        message: "Each dbt dimension can appear only once in groupBy.",
      });
    }
  });
type MetricQuerySpec = z.infer<typeof metricQuerySpecSchema>;
const queryMetricOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("connection_selection_required"),
    message: z.string(),
    connections: z.array(
      z.object({ id: z.string(), label: z.string(), status: z.string() }),
    ),
  }),
  z.object({
    status: z.enum(["connection_error", "provider_error"]),
    metricName: z.string(),
    connection: metricConnectionSchema,
    queryId: z.string().optional(),
    nextPage: z.string().optional(),
    querySpec: metricQuerySpecSchema.optional(),
    message: z.string(),
  }),
  z.object({
    status: z.literal("connection_unavailable"),
    metricName: z.string(),
    connection: metricConnectionSchema,
    message: z.string(),
  }),
  z.object({
    status: z.literal("metadata_truncated"),
    metricName: z.string(),
    searched: z.number(),
    of: z.number(),
    truncated: z.literal(true),
    nextPage: z.string(),
    message: z.string(),
  }),
  z.object({
    status: z.enum(["not_found", "ambiguous_metric"]),
    metricName: z.string(),
    searched: z.number(),
    of: z.number(),
  }),
  z.object({
    status: z.literal("no_metrics_available"),
    metricName: z.string(),
    message: z.string(),
  }),
  z.object({
    status: z.literal("success"),
    metric: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        type: z.string().optional(),
        dimensionsCount: z.number(),
        dimensionsTruncated: z.boolean(),
        dimensions: z.array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            type: z.string().optional(),
            queryableGranularities: z.array(z.string()),
          }),
        ),
        queryableGranularities: z.array(z.string()),
        queryableGranularitiesCount: z.number(),
        queryableGranularitiesTruncated: z.boolean(),
      })
      .optional(),
    querySpec: metricQuerySpecSchema,
    rows: z.array(z.unknown()),
    rowCount: z.number(),
    truncated: z.boolean(),
    truncationReason: z.literal("query_row_cap").optional(),
    nextPage: z.string().optional(),
    queryId: z.string(),
    connection: metricConnectionSchema,
    source: z.literal("dbt-semantic-layer"),
  }),
  z.object({
    status: z.literal("pending"),
    metricName: z.string(),
    queryId: z.string(),
    nextPage: z.string().optional(),
    querySpec: metricQuerySpecSchema,
    message: z.string(),
    connection: metricConnectionSchema,
    source: z.literal("dbt-semantic-layer"),
  }),
  z.object({
    status: z.literal("incomplete_result"),
    metricName: z.string(),
    queryId: z.string(),
    nextPage: z.string().optional(),
    querySpec: metricQuerySpecSchema,
    message: z.string(),
    connection: metricConnectionSchema,
    source: z.literal("dbt-semantic-layer"),
  }),
  z.object({
    status: z.enum([
      "deployment_not_ready",
      "empty_semantic_manifest",
      "permission_denied",
    ]),
    metricName: z.string(),
    queryId: z.string().optional(),
    nextPage: z.string().optional(),
    querySpec: metricQuerySpecSchema.optional(),
    message: z.string(),
  }),
]);

type GraphQlResult = {
  response?: {
    ok?: boolean;
    status?: number;
    json?: unknown;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type DbtFailureState =
  | "connection_error"
  | "provider_error"
  | "deployment_not_ready"
  | "empty_semantic_manifest"
  | "permission_denied";

const METRIC_RESULT_CURSOR_PREFIX = "metric-results-v2.";
const METRIC_RESULT_CURSOR_V3_PREFIX = "metric-results-v3.";

type MetricResultCursor = {
  metricName: string;
  queryId: string;
  connectionId: string;
  environmentId: string;
  pageNum: number;
  rowOffset: number;
  rowsBeforePage: number;
  querySpec: MetricQuerySpec;
};

function encodeMetricResultCursor(cursor: MetricResultCursor): string {
  return `${METRIC_RESULT_CURSOR_V3_PREFIX}${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

function decodeMetricResultCursor(value: string): MetricResultCursor | null {
  const prefix = value.startsWith(METRIC_RESULT_CURSOR_V3_PREFIX)
    ? METRIC_RESULT_CURSOR_V3_PREFIX
    : value.startsWith(METRIC_RESULT_CURSOR_PREFIX)
      ? METRIC_RESULT_CURSOR_PREFIX
      : null;
  if (!prefix) return null;
  try {
    const payload = value.slice(prefix.length);
    const parsed = record(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (
      typeof parsed.metricName !== "string" ||
      typeof parsed.queryId !== "string" ||
      typeof parsed.connectionId !== "string" ||
      typeof parsed.environmentId !== "string" ||
      !Number.isSafeInteger(parsed.pageNum) ||
      (parsed.pageNum as number) < 1 ||
      (parsed.pageNum as number) > 100_000 ||
      !Number.isSafeInteger(parsed.rowOffset) ||
      (parsed.rowOffset as number) < 0 ||
      (parsed.rowOffset as number) > 1_000_000 ||
      !Number.isSafeInteger(parsed.rowsBeforePage) ||
      (parsed.rowsBeforePage as number) < 0 ||
      (parsed.rowsBeforePage as number) > MAX_METRIC_QUERY_ROWS
    ) {
      return null;
    }
    let querySpec: MetricQuerySpec;
    if (parsed.querySpec === undefined) {
      querySpec = metricQuerySpecSchema.parse({ groupBy: [] });
    } else {
      const parsedQuerySpec = metricQuerySpecSchema.safeParse(parsed.querySpec);
      if (!parsedQuerySpec.success) return null;
      querySpec = parsedQuerySpec.data;
    }
    return {
      ...(parsed as Omit<MetricResultCursor, "querySpec">),
      querySpec,
    };
  } catch {
    // coercion-ok: invalid cursor payloads are returned as absent and rejected by the action.
    return null;
  }
}

class DbtSemanticLayerError extends Error {
  constructor(
    readonly status: DbtFailureState,
    message: string,
  ) {
    super(message);
    this.name = "DbtSemanticLayerError";
  }
}

class DbtRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbtRequestTimeoutError";
  }
}

function isProviderRequestTimeout(error: unknown): boolean {
  const item = record(error);
  const cause = record(item.cause);
  return (
    (typeof item.message === "string" &&
      /^Provider API request timed out after \d+ms\b/i.test(item.message)) ||
    item.name === "TimeoutError" ||
    cause.name === "AbortError"
  );
}

function graphQlErrors(value: unknown): {
  messages: string[];
  codes: string[];
} {
  const body = record(value);
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const messages: string[] = [];
  const codes: string[] = [];
  for (const error of errors.slice(0, 3)) {
    const item = record(error);
    if (typeof item.message === "string") messages.push(item.message);
    const code = record(item.extensions).code;
    if (typeof code === "string") codes.push(code);
  }
  return { messages, codes };
}

function safeDbtMessage(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(
      /\b(?:bearer|api[_ -]?key|secret|password|token)\s*[:=]\s*\S+/gi,
      "[redacted credential]",
    )
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .slice(0, 600);
}

function classifyDbtFailure(
  value: unknown,
  httpStatus?: number,
): DbtSemanticLayerError | null {
  const { messages, codes } = graphQlErrors(value);
  const message = safeDbtMessage(messages.join("; "));
  if (/empty semantic manifest/i.test(message)) {
    return new DbtSemanticLayerError(
      "empty_semantic_manifest",
      "This dbt environment has no semantic models or metrics yet.",
    );
  }
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    codes.some((code) => /FORBIDDEN|UNAUTHENTICATED|PERMISSION/i.test(code)) ||
    /permission denied|not authorized|unauthorized|forbidden|insufficient (?:permission|scope)|missing(?: the)? [\w -]{1,60}permission/i.test(
      message,
    )
  ) {
    return new DbtSemanticLayerError(
      "permission_denied",
      message || `dbt refused the Semantic Layer request (HTTP ${httpStatus}).`,
    );
  }
  if (
    /environment.{0,80}(?:successful run|successful dbt run|deployment|deploy|compile)|(?:successful run|successful dbt run|deployment|deploy|compile).{0,80}environment|semantic layer.{0,80}(?:not available|not deployed|not configured)/i.test(
      message,
    )
  ) {
    return new DbtSemanticLayerError(
      "deployment_not_ready",
      message ||
        "This dbt environment needs a successful deployment run before its Semantic Layer can be queried.",
    );
  }
  return null;
}

function graphQlData(
  value: unknown,
  httpStatus?: number,
): Record<string, unknown> {
  const failure = classifyDbtFailure(value, httpStatus);
  if (failure) throw failure;
  const { messages } = graphQlErrors(value);
  if (messages.length > 0) {
    throw new DbtSemanticLayerError(
      "provider_error",
      `dbt Semantic Layer returned a GraphQL error: ${safeDbtMessage(messages.join("; "))}`,
    );
  }
  const body = record(value);
  const data = record(body.data);
  if (!Object.keys(data).length) {
    throw new DbtSemanticLayerError(
      "provider_error",
      "dbt Semantic Layer returned no data.",
    );
  }
  return data;
}

function dateDayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  const canonical = new Date(timestamp).toISOString().slice(0, 10);
  return canonical === value ? timestamp / 86_400_000 : null;
}

function queryableGranularities(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toUpperCase())
    : [];
}

function validateMetricQuerySpec(
  metric: Record<string, unknown>,
  querySpec: MetricQuerySpec,
): {
  groupBy: Array<{ name: string; grain?: string }>;
  where: Array<{ sql: string }>;
} {
  const metricGranularities = queryableGranularities(
    metric.queryableGranularities,
  );
  const dimensions = Array.isArray(metric.dimensions)
    ? metric.dimensions.map(record)
    : [];
  const groupBy = querySpec.groupBy.map(({ name, grain }) => {
    if (name === "metric_time") {
      if (!grain) {
        fail(
          "Choose a grain for metric_time from the metric's queryable granularities.",
          {
            errorCode: "dbt_metric_dimension_invalid",
            statusCode: 400,
          },
        );
      }
      if (!metricGranularities.includes(grain)) {
        fail(`The metric does not support the ${grain} metric_time grain.`, {
          errorCode: "dbt_metric_grain_unsupported",
          statusCode: 400,
        });
      }
      return { name, grain };
    }

    const dimension = dimensions.find((item) => item.name === name);
    if (!dimension) {
      fail(`The metric does not expose a dimension named ${name}.`, {
        errorCode: "dbt_metric_dimension_invalid",
        statusCode: 400,
      });
    }
    const dimensionType =
      typeof dimension.type === "string" ? dimension.type.toUpperCase() : "";
    const dimensionGranularities = queryableGranularities(
      dimension.queryableGranularities,
    );
    const isTimeDimension =
      dimensionType === "TIME" || dimensionGranularities.length > 0;
    if (isTimeDimension && !grain) {
      fail(`Choose a grain for the time dimension ${name}.`, {
        errorCode: "dbt_metric_grain_required",
        statusCode: 400,
      });
    }
    if (grain && !dimensionGranularities.includes(grain)) {
      fail(`The dimension ${name} does not support the ${grain} grain.`, {
        errorCode: "dbt_metric_grain_unsupported",
        statusCode: 400,
      });
    }
    if (!isTimeDimension && grain) {
      fail(`The categorical dimension ${name} does not accept a time grain.`, {
        errorCode: "dbt_metric_grain_invalid",
        statusCode: 400,
      });
    }
    return grain ? { name, grain } : { name };
  });

  const where = querySpec.timeRange
    ? (() => {
        if (!metricGranularities.includes("DAY")) {
          fail(
            "This metric does not support day-grain filtering on metric_time, so the requested date range cannot be applied safely.",
            {
              errorCode: "dbt_metric_grain_unsupported",
              statusCode: 400,
            },
          );
        }
        const { startDate, endDate } = querySpec.timeRange;
        return [
          {
            sql: `{{ TimeDimension('metric_time', 'day') }} >= '${startDate}'`,
          },
          {
            sql: `{{ TimeDimension('metric_time', 'day') }} <= '${endDate}'`,
          },
        ];
      })()
    : [];

  return { groupBy, where };
}

async function executeGraphQl(args: {
  connectionId: string;
  body: { query: string; variables: Record<string, unknown> };
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  let result: GraphQlResult;
  try {
    result = (await executeProviderApiRequest({
      provider: "dbt",
      method: "POST",
      path: "/api/graphql",
      body: args.body,
      connectionId: args.connectionId,
      timeoutMs: 3_000,
      maxBytes: 500_000,
      ...(args.signal ? { signal: args.signal } : {}),
    })) as GraphQlResult;
  } catch (error) {
    if (isAgentConnectionRequiredError(error)) throw error;
    if (args.signal?.aborted) throw error;
    if (isProviderRequestTimeout(error)) {
      throw new DbtRequestTimeoutError(
        error instanceof Error
          ? safeDbtMessage(error.message) ||
              "The dbt Semantic Layer request timed out."
          : "The dbt Semantic Layer request timed out.",
      );
    }
    throw new DbtSemanticLayerError(
      "connection_error",
      error instanceof Error
        ? safeDbtMessage(error.message) ||
            "The dbt workspace connection could not reach the Semantic Layer."
        : "The dbt workspace connection could not reach the Semantic Layer.",
    );
  }
  const response = result.response;
  if (!response || response.ok === false) {
    if (response?.status === 408 || response?.status === 504) {
      throw new DbtRequestTimeoutError(
        `The dbt Semantic Layer request timed out with HTTP ${response.status}.`,
      );
    }
    const failure = classifyDbtFailure(response?.json, response?.status);
    if (failure) throw failure;
    throw new DbtSemanticLayerError(
      "connection_error",
      `The dbt Semantic Layer request failed${response?.status ? ` with HTTP ${response.status}` : ""}.`,
    );
  }
  return graphQlData(response.json, response.status);
}

function parseRows(value: unknown): unknown[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new DbtSemanticLayerError(
        "provider_error",
        "dbt Semantic Layer returned unreadable metric results.",
      );
    }
  }
  if (Array.isArray(parsed)) return parsed;
  const result = record(parsed);
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.rows)) return result.rows;
  throw new DbtSemanticLayerError(
    "provider_error",
    "dbt Semantic Layer did not return tabular metric results.",
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("aborted"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default defineAction({
  description:
    "Query an exact owner-defined dbt Semantic Layer metric through the caller's workspace connection. Supports exact metadata-validated dimension grouping and inclusive date ranges up to 366 days; returns the metric definition, querySpec, bounded live rows, and explicit permission, deployment, or connection states. Grouped time columns are returned as metric_time__<GRAIN>. It cannot run dbt jobs or accept arbitrary GraphQL.",
  schema: z
    .object({
      metricName: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .describe("Exact dbt Semantic Layer metric name, not a display label"),
      connectionId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Choose this when the workspace has multiple dbt connections",
        ),
      queryId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{1,120}$/)
        .optional()
        .describe(
          "Resume polling with the query ID and matching nextPage cursor returned by this action",
        ),
      nextPage: z
        .string()
        .max(2_048)
        .regex(
          /^(?:metric-metadata:[1-9]\d{0,3}|metric-results-v[23]\.[A-Za-z0-9_-]{1,2000})$/,
        )
        .optional()
        .describe(
          "Continue an exact-name metadata search or bounded metric result page; result cursors preserve the selected connection, grouping, and date range",
        ),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe(
          "Maximum rows per action response; defaults to 20 and is capped at 100. Each MetricFlow query is separately capped at 1,000 total rows.",
        ),
      groupBy: z
        .array(metricGroupBySchema)
        .min(1)
        .max(5)
        .optional()
        .describe(
          "Optional exact dbt dimension names to group by; grouped queries require timeRange and each dimension must appear in the selected metric metadata",
        ),
      timeRange: metricTimeRangeSchema
        .optional()
        .describe(
          `Optional inclusive metric_time date range in YYYY-MM-DD format; maximum ${MAX_METRIC_QUERY_DAYS} days. Required when groupBy is set.`,
        ),
    })
    .strict()
    .superRefine(({ queryId, nextPage, groupBy, timeRange }, context) => {
      if (groupBy?.length && !timeRange) {
        context.addIssue({
          code: "custom",
          path: ["timeRange"],
          message:
            "Dimension-grouped MetricFlow queries require a bounded date range.",
        });
      }
      if (
        groupBy &&
        new Set(groupBy.map(({ name }) => name)).size !== groupBy.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["groupBy"],
          message: "Each dbt dimension can appear only once in groupBy.",
        });
      }
      const resultCursor = Boolean(
        nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX) ||
        nextPage?.startsWith(METRIC_RESULT_CURSOR_V3_PREFIX),
      );
      if (queryId && !resultCursor) {
        context.addIssue({
          code: "custom",
          path: ["nextPage"],
          message:
            "A queryId continuation requires its matching MetricFlow result-page cursor so the original grouping and date range are preserved.",
        });
      }
      if (!queryId && resultCursor) {
        context.addIssue({
          code: "custom",
          path: ["queryId"],
          message: "A MetricFlow result page requires its queryId.",
        });
      }
      if (queryId && ((groupBy?.length ?? 0) > 0 || timeRange)) {
        context.addIssue({
          code: "custom",
          path: ["queryId"],
          message:
            "Continue a MetricFlow query with its queryId and nextPage cursor only; the cursor preserves its grouping and date range.",
        });
      }
    }),
  outputSchema: queryMetricOutputSchema,
  readOnly: true,
  parallelSafe: true,
  mcpTool: true,
  http: { method: "POST" },
  run: async ({
    metricName,
    connectionId,
    queryId,
    nextPage,
    limit,
    groupBy,
    timeRange,
  }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("An authenticated user is required to query dbt metrics.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    const connections = await listWorkspaceConnectionsForApp({
      appId: ANALYTICS_APP_ID,
      provider: "dbt",
      includeDisabled: true,
    });
    const isMetricResultCursor =
      nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX) ||
      nextPage?.startsWith(METRIC_RESULT_CURSOR_V3_PREFIX);
    const resultCursor = isMetricResultCursor
      ? decodeMetricResultCursor(nextPage!)
      : null;
    if (isMetricResultCursor && !resultCursor) {
      fail("The metric result cursor is invalid.", {
        errorCode: "invalid_metric_result_cursor",
        statusCode: 400,
      });
    }
    const selectedConnectionId = connectionId ?? resultCursor?.connectionId;
    const selected = selectedConnectionId
      ? connections.find((connection) => connection.id === selectedConnectionId)
      : connections.length === 1
        ? connections[0]
        : null;
    if (!selected && connections.length > 1 && !selectedConnectionId) {
      return {
        status: "connection_selection_required",
        message:
          "Choose a connected dbt workspace connection to run this metric.",
        connections: connections.map(({ id, label, status }) => ({
          id,
          label,
          status,
        })),
      };
    }
    if (!selected) {
      throw new AgentConnectionRequiredError(
        "Connect dbt Semantic Layer in Settings → Integrations to query this metric.",
        { provider: "dbt", appId: ANALYTICS_APP_ID },
      );
    }
    if (selected.status === "needs_reauth") {
      throw new AgentConnectionRequiredError(
        "Reconnect the selected dbt Semantic Layer workspace connection.",
        {
          provider: "dbt",
          reason: "reauthorize",
          appId: ANALYTICS_APP_ID,
        },
      );
    }
    if (selected.status === "error") {
      return {
        status: "connection_error",
        metricName,
        connection: { id: selected.id, label: selected.label },
        message:
          "The dbt workspace connection has an error. Check or reconnect it in Settings → Integrations.",
      };
    }
    if (selected.status !== "connected") {
      return {
        status: "connection_unavailable",
        metricName,
        connection: { id: selected.id, label: selected.label },
        message: "The selected dbt workspace connection is not ready yet.",
      };
    }

    const configuredEnvironmentId = selected.config[DBT_ENVIRONMENT_FIELD];
    const environmentId =
      typeof configuredEnvironmentId === "string"
        ? configuredEnvironmentId.trim()
        : "";
    if (!environmentId) {
      return {
        status: "connection_error",
        metricName,
        connection: { id: selected.id, label: selected.label },
        message:
          "Set the dbt environment ID for this workspace connection in Settings → Integrations, then retry.",
      };
    }
    if (!/^\d+$/.test(environmentId)) {
      fail("The dbt workspace connection has an invalid environment ID.", {
        errorCode: "dbt_environment_invalid",
        statusCode: 400,
      });
    }

    if (
      nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX) ||
      nextPage?.startsWith(METRIC_RESULT_CURSOR_V3_PREFIX)
    ) {
      if (
        !resultCursor ||
        !queryId ||
        resultCursor.metricName !== metricName ||
        resultCursor.queryId !== queryId ||
        resultCursor.connectionId !== selected.id ||
        resultCursor.environmentId !== environmentId
      ) {
        fail(
          "The metric result cursor is invalid or belongs to another query.",
          {
            errorCode: "invalid_metric_result_cursor",
            statusCode: 400,
          },
        );
      }
    }

    const requestedQuerySpec = metricQuerySpecSchema.parse({
      groupBy: groupBy ?? [],
      ...(timeRange ? { timeRange } : {}),
    });
    let activeQuerySpec = resultCursor?.querySpec ?? requestedQuerySpec;

    const token = await resolveWorkspaceConnectionCredentialForApp({
      appId: ANALYTICS_APP_ID,
      provider: "dbt",
      key: "DBT_SEMANTIC_LAYER_TOKEN",
      connectionId: selected.id,
      userEmail,
      orgId,
    });
    if (token.status === "error") {
      return {
        status: "connection_error",
        metricName,
        connection: { id: selected.id, label: selected.label },
        message:
          "The dbt workspace token could not be read. Retry the request or repair the workspace connection.",
      };
    }
    if (!token.available || !token.value) {
      throw new AgentConnectionRequiredError(
        "Add the dbt Semantic Layer token to this workspace connection, then retry.",
        { provider: "dbt", appId: ANALYTICS_APP_ID },
      );
    }

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 12_000);
    let activeQueryId = queryId;
    let initialResultPageCursor: string | undefined;
    try {
      let metric: Record<string, unknown> = { name: metricName };
      if (!activeQueryId) {
        const exactMatches: Record<string, unknown>[] = [];
        const startPage = nextPage?.startsWith("metric-metadata:")
          ? Number(nextPage.slice("metric-metadata:".length))
          : 1;
        let pageCount = startPage - 1;
        let totalItems = 0;
        let itemsSeen = 0;
        const finalPage = startPage + MAX_METADATA_PAGES - 1;
        while (pageCount < finalPage) {
          const lookup = await executeGraphQl({
            connectionId: selected.id,
            signal: controller.signal,
            body: {
              query: LOOKUP_METRIC,
              variables: {
                environmentId,
                search: metricName,
                pageNum: pageCount + 1,
              },
            },
          });
          const page = record(lookup.metricsPaginated);
          if (
            !Array.isArray(page.items) ||
            typeof page.totalItems !== "number" ||
            typeof page.totalPages !== "number"
          ) {
            fail(
              "dbt Semantic Layer returned incomplete metric metadata pagination.",
              {
                errorCode: "dbt_invalid_metadata_page",
                statusCode: 502,
              },
            );
          }
          const items = page.items;
          pageCount += 1;
          itemsSeen += items.length;
          totalItems = page.totalItems;
          exactMatches.push(
            ...items.map(record).filter((item) => item.name === metricName),
          );
          const totalPages = page.totalPages;
          if (exactMatches.length || pageCount >= totalPages) break;
        }
        if (!exactMatches.length && pageCount < Math.ceil(totalItems / 100)) {
          return {
            status: "metadata_truncated",
            metricName,
            searched: Math.min(totalItems, (startPage - 1) * 100 + itemsSeen),
            of: totalItems,
            truncated: true,
            nextPage: `metric-metadata:${pageCount + 1}`,
            message:
              "The dbt metric search reached its page limit. Refine the exact metric name or continue from the next metadata page.",
          };
        }
        if (exactMatches.length !== 1) {
          if (exactMatches.length === 0) {
            const manifest = await executeGraphQl({
              connectionId: selected.id,
              signal: controller.signal,
              body: {
                query: COUNT_METRICS,
                variables: { environmentId },
              },
            });
            const totalItems = record(manifest.metricsPaginated).totalItems;
            if (
              typeof totalItems !== "number" ||
              !Number.isInteger(totalItems) ||
              totalItems < 0
            ) {
              fail(
                "dbt Semantic Layer returned an invalid semantic manifest count.",
                {
                  errorCode: "dbt_invalid_metadata_count",
                  statusCode: 502,
                },
              );
            }
            if (totalItems === 0) {
              return {
                status: "no_metrics_available",
                metricName,
                message:
                  "This dbt environment has no metrics available. Semantic models may still exist without metrics.",
              };
            }
          }
          return {
            status: exactMatches.length > 1 ? "ambiguous_metric" : "not_found",
            metricName,
            searched: Math.min(totalItems, (startPage - 1) * 100 + itemsSeen),
            of: totalItems,
          };
        }
        metric = exactMatches[0]!;
        if (!activeQueryId) {
          const metricQuery = validateMetricQuerySpec(metric, activeQuerySpec);
          const created = await executeGraphQl({
            connectionId: selected.id,
            signal: controller.signal,
            body: {
              query: CREATE_METRIC_QUERY,
              variables: {
                environmentId,
                metricName,
                groupBy: metricQuery.groupBy.length
                  ? metricQuery.groupBy
                  : null,
                where: metricQuery.where.length ? metricQuery.where : null,
                queryRowCap: MAX_METRIC_QUERY_ROWS,
              },
            },
          });
          const returnedQueryId = record(created.createQuery).queryId;
          if (typeof returnedQueryId !== "string" || !returnedQueryId.trim()) {
            throw new DbtSemanticLayerError(
              "provider_error",
              "dbt Semantic Layer did not return a resumable metric query ID.",
            );
          }
          activeQueryId = returnedQueryId;
        }
      }

      initialResultPageCursor = encodeMetricResultCursor({
        metricName,
        queryId: activeQueryId,
        connectionId: selected.id,
        environmentId,
        pageNum: 1,
        rowOffset: 0,
        rowsBeforePage: 0,
        querySpec: activeQuerySpec,
      });
      const resultPageNum = resultCursor?.pageNum ?? 1;
      const resultRowOffset = resultCursor?.rowOffset ?? 0;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        const response = await executeGraphQl({
          connectionId: selected.id,
          signal: controller.signal,
          body: {
            query: READ_METRIC_QUERY,
            variables: {
              environmentId,
              queryId: activeQueryId,
              pageNum: resultPageNum,
            },
          },
        });
        const query = record(response.query);
        const status = typeof query.status === "string" ? query.status : "";
        if (status === "FAILED") {
          const failure = classifyDbtFailure({
            errors: [{ message: query.error }],
          });
          if (failure) {
            return {
              status: failure.status,
              metricName,
              message: failure.message,
            };
          }
          return {
            status: "provider_error",
            metricName,
            connection: { id: selected.id, label: selected.label },
            message:
              safeDbtMessage(query.error) ||
              "MetricFlow marked this query as failed. Fix the reported issue, then start a new metric query.",
          };
        }
        if (status === "SUCCESSFUL") {
          const rows = parseRows(query.jsonResult);
          const totalPages = query.totalPages;
          if (
            typeof totalPages !== "number" ||
            !Number.isSafeInteger(totalPages) ||
            totalPages < resultPageNum ||
            totalPages > 100_000
          ) {
            return {
              status: "incomplete_result",
              metricName,
              queryId: activeQueryId,
              nextPage: resultCursor ? nextPage! : initialResultPageCursor,
              querySpec: activeQuerySpec,
              message:
                "MetricFlow marked the query successful but returned missing or invalid pagination metadata. Retry this query page; result completeness is unknown.",
              connection: { id: selected.id, label: selected.label },
              source: "dbt-semantic-layer",
            };
          }
          const rowsBeforePage = resultCursor?.rowsBeforePage ?? 0;
          const queryRowsRemaining = MAX_METRIC_QUERY_ROWS - rowsBeforePage;
          const pageRows = rows.slice(0, queryRowsRemaining);
          if (resultRowOffset > 0 && resultRowOffset >= pageRows.length) {
            throw new DbtSemanticLayerError(
              "provider_error",
              "dbt Semantic Layer returned an invalid metric result page.",
            );
          }
          const resultRows = pageRows.slice(
            resultRowOffset,
            resultRowOffset + limit,
          );
          const nextRowOffset = resultRowOffset + resultRows.length;
          const rowsBeforeNextPage = rowsBeforePage + pageRows.length;
          const queryRowCapReached =
            rowsBeforeNextPage >= MAX_METRIC_QUERY_ROWS;
          const nextResultPage =
            nextRowOffset < pageRows.length
              ? encodeMetricResultCursor({
                  metricName,
                  queryId: activeQueryId,
                  connectionId: selected.id,
                  environmentId,
                  pageNum: resultPageNum,
                  rowOffset: nextRowOffset,
                  rowsBeforePage,
                  querySpec: activeQuerySpec,
                })
              : resultPageNum < totalPages && !queryRowCapReached
                ? encodeMetricResultCursor({
                    metricName,
                    queryId: activeQueryId,
                    connectionId: selected.id,
                    environmentId,
                    pageNum: resultPageNum + 1,
                    rowOffset: 0,
                    rowsBeforePage: rowsBeforeNextPage,
                    querySpec: activeQuerySpec,
                  })
                : undefined;
          const dimensions = Array.isArray(metric.dimensions)
            ? metric.dimensions
                .map(record)
                .filter((dimension) => typeof dimension.name === "string")
            : [];
          const allMetricGranularities = queryableGranularities(
            metric.queryableGranularities,
          );
          return {
            status: "success",
            ...(!resultCursor
              ? {
                  metric: {
                    name: metricName,
                    ...(typeof metric.description === "string"
                      ? { description: metric.description }
                      : {}),
                    ...(typeof metric.type === "string"
                      ? { type: metric.type }
                      : {}),
                    dimensionsCount: dimensions.length,
                    dimensionsTruncated: dimensions.length > 30,
                    dimensions: dimensions.slice(0, 30).map((dimension) => ({
                      name: dimension.name as string,
                      ...(typeof dimension.description === "string"
                        ? { description: dimension.description }
                        : {}),
                      ...(typeof dimension.type === "string"
                        ? { type: dimension.type }
                        : {}),
                      queryableGranularities: queryableGranularities(
                        dimension.queryableGranularities,
                      ),
                    })),
                    queryableGranularities: allMetricGranularities.slice(0, 10),
                    queryableGranularitiesCount: allMetricGranularities.length,
                    queryableGranularitiesTruncated:
                      allMetricGranularities.length > 10,
                  },
                }
              : {}),
            querySpec: activeQuerySpec,
            rows: resultRows,
            rowCount: resultRows.length,
            truncated: nextResultPage !== undefined || queryRowCapReached,
            ...(queryRowCapReached
              ? { truncationReason: "query_row_cap" as const }
              : {}),
            ...(nextResultPage ? { nextPage: nextResultPage } : {}),
            queryId: activeQueryId,
            connection: { id: selected.id, label: selected.label },
            source: "dbt-semantic-layer",
          };
        }
        if (status !== "PENDING" && status !== "RUNNING") {
          throw new DbtSemanticLayerError(
            "provider_error",
            status
              ? `dbt Semantic Layer returned an unsupported query status (${safeDbtMessage(status)}).`
              : "dbt Semantic Layer returned no query status.",
          );
        }
        if (attempt < MAX_POLL_ATTEMPTS - 1) {
          await sleep(POLL_INTERVAL_MS, controller.signal);
        }
      }
      return {
        status: "pending",
        metricName,
        queryId: activeQueryId,
        nextPage: resultCursor ? nextPage! : initialResultPageCursor,
        querySpec: activeQuerySpec,
        message:
          "The MetricFlow query is still running. Call this action again with the same metricName, queryId, and returned nextPage cursor to continue polling.",
        connection: { id: selected.id, label: selected.label },
        source: "dbt-semantic-layer",
      };
    } catch (error) {
      if (error instanceof DbtSemanticLayerError) {
        const hasRecovery = Boolean(activeQueryId && initialResultPageCursor);
        const recovery = hasRecovery
          ? {
              queryId: activeQueryId!,
              nextPage: resultCursor ? nextPage! : initialResultPageCursor!,
              querySpec: activeQuerySpec,
            }
          : {};
        return {
          status: error.status,
          metricName,
          ...recovery,
          ...(error.status === "connection_error" ||
          error.status === "provider_error"
            ? { connection: { id: selected.id, label: selected.label } }
            : {}),
          message: hasRecovery
            ? `${error.message} Retry with the same metricName, queryId, and nextPage cursor to resume.`
            : error.message,
        };
      }
      if (error instanceof DbtRequestTimeoutError) {
        if (activeQueryId) {
          return {
            status: "pending",
            metricName,
            queryId: activeQueryId,
            nextPage: resultCursor ? nextPage! : initialResultPageCursor,
            querySpec: activeQuerySpec,
            message: `${error.message} Retry with the same queryId and nextPage cursor to resume.`,
            connection: { id: selected.id, label: selected.label },
            source: "dbt-semantic-layer",
          };
        }
        return {
          status: "connection_error",
          metricName,
          connection: { id: selected.id, label: selected.label },
          message:
            "The dbt Semantic Layer request timed out before a resumable query ID was received. Retry the metric request.",
        };
      }
      if (controller.signal.aborted) {
        if (activeQueryId) {
          return {
            status: "pending",
            metricName,
            queryId: activeQueryId,
            nextPage: resultCursor ? nextPage! : initialResultPageCursor,
            querySpec: activeQuerySpec,
            message:
              "The MetricFlow query exceeded the action time budget. Retry with the same queryId and nextPage cursor to resume.",
            connection: { id: selected.id, label: selected.label },
            source: "dbt-semantic-layer",
          };
        }
        return {
          status: "connection_error",
          metricName,
          connection: { id: selected.id, label: selected.label },
          message:
            "The dbt Semantic Layer request exceeded the action time budget before a resumable query ID was received. Retry the metric request.",
        };
      }
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  },
});

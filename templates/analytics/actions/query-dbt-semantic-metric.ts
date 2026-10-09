import {
  AgentConnectionRequiredError,
  defineAction,
  fail,
  isAgentConnectionRequiredError,
} from "@agent-native/core/action";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
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
    items { name description type dimensions { name description type } queryableGranularities }
    totalItems
    totalPages
  }
}`;

const COUNT_METRICS = `query AnalyticsMetricCount($environmentId: BigInt!) {
  metricsPaginated(environmentId: $environmentId, pageNum: 1, pageSize: 1) {
    totalItems
  }
}`;

const CREATE_METRIC_QUERY = `mutation AnalyticsMetricQuery($environmentId: BigInt!, $metricName: String!, $limit: Int!) {
  createQuery(environmentId: $environmentId, metrics: [{ name: $metricName }], limit: $limit) {
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
const DBT_ENVIRONMENT_FIELD = "semanticLayerEnvironmentId";
const DBT_DEFAULT_ENVIRONMENT_ID = getWorkspaceConnectionProvider(
  "dbt",
)?.configurationFields?.find(
  ({ key }) => key === DBT_ENVIRONMENT_FIELD,
)?.defaultValue;
const metricConnectionSchema = z.object({ id: z.string(), label: z.string() });
const queryMetricOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("connection_selection_required"),
    message: z.string(),
    connections: z.array(
      z.object({ id: z.string(), label: z.string(), status: z.string() }),
    ),
  }),
  z.object({
    status: z.literal("connection_error"),
    metricName: z.string(),
    connection: metricConnectionSchema,
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
    metric: z.object({
      name: z.string(),
      description: z.string().optional(),
      type: z.string().optional(),
      dimensions: z.array(
        z.object({ name: z.string(), description: z.string().optional() }),
      ),
      queryableGranularities: z.array(z.unknown()),
    }),
    rows: z.array(z.unknown()),
    rowCount: z.number(),
    truncated: z.boolean(),
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
  | "deployment_not_ready"
  | "empty_semantic_manifest"
  | "permission_denied";

const METRIC_RESULT_CURSOR_PREFIX = "metric-results-v1.";

type MetricResultCursor = {
  metricName: string;
  queryId: string;
  connectionId: string;
  environmentId: string;
  pageNum: number;
  rowOffset: number;
};

function encodeMetricResultCursor(cursor: MetricResultCursor): string {
  return `${METRIC_RESULT_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

function decodeMetricResultCursor(value: string): MetricResultCursor | null {
  if (!value.startsWith(METRIC_RESULT_CURSOR_PREFIX)) return null;
  try {
    const payload = value.slice(METRIC_RESULT_CURSOR_PREFIX.length);
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
      (parsed.rowOffset as number) > 1_000_000
    ) {
      return null;
    }
    return parsed as MetricResultCursor;
  } catch {
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
    /permission denied|not authorized|unauthorized|forbidden|insufficient (?:permission|scope)/i.test(
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
    fail(
      `dbt Semantic Layer returned a GraphQL error: ${safeDbtMessage(messages.join("; "))}`,
      {
        errorCode: "dbt_graphql_error",
        statusCode: 502,
      },
    );
  }
  const body = record(value);
  const data = record(body.data);
  if (!Object.keys(data).length) {
    fail("dbt Semantic Layer returned no data.", {
      errorCode: "dbt_invalid_response",
      statusCode: 502,
    });
  }
  return data;
}

async function executeGraphQl(args: {
  connectionId: string;
  body: { query: string; variables: Record<string, string | number> };
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
      fail("dbt Semantic Layer returned unreadable metric results.", {
        errorCode: "dbt_invalid_result",
        statusCode: 502,
      });
    }
  }
  if (Array.isArray(parsed)) return parsed;
  const result = record(parsed);
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.rows)) return result.rows;
  fail("dbt Semantic Layer did not return tabular metric results.", {
    errorCode: "dbt_invalid_result",
    statusCode: 502,
  });
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
    "Query an exact owner-defined dbt Semantic Layer metric through the caller's workspace connection. Returns the metric definition, bounded live rows, and explicit permission, deployment, or connection states; it cannot run dbt jobs or accept arbitrary GraphQL.",
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
        .describe("Resume polling a query ID returned by this action"),
      nextPage: z
        .string()
        .max(2_048)
        .regex(
          /^(?:metric-metadata:[1-9]\d{0,3}|metric-results-v1\.[A-Za-z0-9_-]{1,2000})$/,
        )
        .optional()
        .describe(
          "Continue an exact-name metadata search or a bounded metric result page",
        ),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum result rows; defaults to 20 and is capped at 100"),
    })
    .strict()
    .superRefine(({ queryId, nextPage }, context) => {
      const resultCursor = nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX);
      if (queryId && nextPage && !resultCursor) {
        context.addIssue({
          code: "custom",
          path: ["nextPage"],
          message:
            "A queryId can only continue a MetricFlow result page, not metric metadata.",
        });
      }
      if (!queryId && resultCursor) {
        context.addIssue({
          code: "custom",
          path: ["queryId"],
          message: "A MetricFlow result page requires its queryId.",
        });
      }
    }),
  outputSchema: queryMetricOutputSchema,
  readOnly: true,
  parallelSafe: true,
  mcpTool: true,
  http: { method: "POST" },
  run: async ({ metricName, connectionId, queryId, nextPage, limit }) => {
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
    const selected = connectionId
      ? connections.find((connection) => connection.id === connectionId)
      : connections.length === 1
        ? connections[0]
        : null;
    if (!selected && connections.length > 1 && !connectionId) {
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
      typeof configuredEnvironmentId === "string" &&
      configuredEnvironmentId.trim()
        ? configuredEnvironmentId.trim()
        : DBT_DEFAULT_ENVIRONMENT_ID;
    if (!environmentId || !/^\d+$/.test(environmentId)) {
      fail("The dbt workspace connection has an invalid environment ID.", {
        errorCode: "dbt_environment_invalid",
        statusCode: 400,
      });
    }

    const resultCursor = nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX)
      ? decodeMetricResultCursor(nextPage)
      : null;
    if (nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX)) {
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
    try {
      let metric: Record<string, unknown> = { name: metricName };
      if (!activeQueryId) {
        const exactMatches: Record<string, unknown>[] = [];
        const startPage = nextPage
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
        const created = await executeGraphQl({
          connectionId: selected.id,
          signal: controller.signal,
          body: {
            query: CREATE_METRIC_QUERY,
            variables: { environmentId, metricName, limit },
          },
        });
        const returnedQueryId = record(created.createQuery).queryId;
        if (typeof returnedQueryId !== "string" || !returnedQueryId.trim()) {
          fail("dbt Semantic Layer did not create a metric query.", {
            errorCode: "dbt_query_not_created",
            statusCode: 502,
          });
        }
        activeQueryId = returnedQueryId;
      }

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
              queryId: activeQueryId,
              message: failure.message,
            };
          }
          fail("dbt Semantic Layer could not calculate this metric.", {
            errorCode: "dbt_metric_query_failed",
            statusCode: 502,
          });
        }
        if (status === "SUCCESSFUL") {
          const rows = parseRows(query.jsonResult);
          const totalPages =
            typeof query.totalPages === "number" ? query.totalPages : 1;
          if (rows.length > 0 && resultRowOffset >= rows.length) {
            fail("dbt Semantic Layer returned an invalid metric result page.", {
              errorCode: "dbt_invalid_result_page",
              statusCode: 502,
            });
          }
          const resultRows = rows.slice(
            resultRowOffset,
            resultRowOffset + limit,
          );
          const nextRowOffset = resultRowOffset + resultRows.length;
          const nextPage =
            nextRowOffset < rows.length
              ? encodeMetricResultCursor({
                  metricName,
                  queryId: activeQueryId,
                  connectionId: selected.id,
                  environmentId,
                  pageNum: resultPageNum,
                  rowOffset: nextRowOffset,
                })
              : resultPageNum < totalPages
                ? encodeMetricResultCursor({
                    metricName,
                    queryId: activeQueryId,
                    connectionId: selected.id,
                    environmentId,
                    pageNum: resultPageNum + 1,
                    rowOffset: 0,
                  })
                : undefined;
          return {
            status: "success",
            metric: {
              name: metricName,
              ...(typeof metric.description === "string"
                ? { description: metric.description }
                : {}),
              ...(typeof metric.type === "string" ? { type: metric.type } : {}),
              dimensions: Array.isArray(metric.dimensions)
                ? metric.dimensions
                    .map(record)
                    .slice(0, 30)
                    .map((dimension) => ({
                      name:
                        typeof dimension.name === "string"
                          ? dimension.name
                          : "",
                      ...(typeof dimension.description === "string"
                        ? { description: dimension.description }
                        : {}),
                    }))
                : [],
              queryableGranularities: Array.isArray(
                metric.queryableGranularities,
              )
                ? metric.queryableGranularities.slice(0, 10)
                : [],
            },
            rows: resultRows,
            rowCount: resultRows.length,
            truncated: nextPage !== undefined,
            ...(nextPage ? { nextPage } : {}),
            queryId: activeQueryId,
            connection: { id: selected.id, label: selected.label },
            source: "dbt-semantic-layer",
          };
        }
        if (!status) {
          fail("dbt Semantic Layer returned an unknown query status.", {
            errorCode: "dbt_unknown_query_status",
            statusCode: 502,
          });
        }
        if (attempt < MAX_POLL_ATTEMPTS - 1) {
          await sleep(POLL_INTERVAL_MS, controller.signal);
        }
      }
      return {
        status: "pending",
        metricName,
        queryId: activeQueryId,
        ...(resultCursor ? { nextPage } : {}),
        message:
          "The MetricFlow query is still running. Call this action again with the same metricName and queryId to continue polling.",
        connection: { id: selected.id, label: selected.label },
        source: "dbt-semantic-layer",
      };
    } catch (error) {
      if (error instanceof DbtSemanticLayerError) {
        return {
          status: error.status,
          metricName,
          ...(activeQueryId ? { queryId: activeQueryId } : {}),
          ...(error.status === "connection_error"
            ? { connection: { id: selected.id, label: selected.label } }
            : {}),
          message: error.message,
        };
      }
      if (controller.signal.aborted) {
        return {
          status: "pending",
          metricName,
          ...(activeQueryId ? { queryId: activeQueryId } : {}),
          message:
            "The MetricFlow query exceeded the action time budget. Retry with the returned queryId when available.",
          connection: { id: selected.id, label: selected.label },
          source: "dbt-semantic-layer",
        };
      }
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  },
});

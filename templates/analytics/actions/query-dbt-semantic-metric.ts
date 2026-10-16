import { createHmac, timingSafeEqual } from "node:crypto";

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
    allTime: z.literal(true).optional(),
  })
  .strict()
  .superRefine(({ groupBy, timeRange, allTime }, context) => {
    if (timeRange && allTime) {
      context.addIssue({
        code: "custom",
        path: ["allTime"],
        message: "Choose either a bounded date range or all time, not both.",
      });
    }
    if (groupBy.length > 0 && (!timeRange || allTime)) {
      context.addIssue({
        code: "custom",
        path: ["timeRange"],
        message:
          "Dimension-grouped MetricFlow queries require a bounded date range.",
      });
    }
    if (groupBy.length === 0 && !timeRange && !allTime) {
      context.addIssue({
        code: "custom",
        path: ["allTime"],
        message:
          "Choose a bounded timeRange or explicitly set allTime to true for a scalar metric query.",
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
const metricDefinitionSchema = z.object({
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
});
type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
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
    metric: metricDefinitionSchema.optional(),
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
    metric: metricDefinitionSchema.optional(),
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
    metric: metricDefinitionSchema.optional(),
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
    metric: metricDefinitionSchema.optional(),
    message: z.string(),
  }),
]);

type GraphQlResult = {
  response?: {
    ok?: boolean;
    status?: number;
    truncated?: boolean;
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

const METRIC_RESULT_CURSOR_PREFIX = "metric-results-v5.";
const METRIC_RESULT_CURSOR_SIGNING_CONTEXT =
  "agent-native:analytics:dbt-semantic-layer:metric-results:v5:";
const METRIC_METADATA_CURSOR_PREFIX = "metric-metadata-v2.";
const METRIC_METADATA_CURSOR_SIGNING_CONTEXT =
  "agent-native:analytics:dbt-semantic-layer:metric-metadata:v2:";

type MetricResultCursor = {
  metricName: string;
  queryId: string;
  connectionId: string;
  environmentId: string;
  pageNum: number;
  rowOffset: number;
  rowsBeforePage: number;
  querySpec: MetricQuerySpec;
  metricDefinition?: MetricDefinition;
};

type DecodedMetricResultCursor = MetricResultCursor & {
  encodedPayload: string;
  signature: string;
};

type MetricMetadataCursor = {
  metricName: string;
  connectionId: string;
  environmentId: string;
  pageNum: number;
  searched: number;
  of: number;
  querySpec: MetricQuerySpec;
};

type DecodedMetricMetadataCursor = MetricMetadataCursor & {
  encodedPayload: string;
  signature: string;
};

function metricResultCursorSignature(payload: string, token: string): Buffer {
  return createHmac("sha256", token)
    .update(`${METRIC_RESULT_CURSOR_SIGNING_CONTEXT}${payload}`)
    .digest();
}

function encodeMetricResultCursor(
  cursor: MetricResultCursor,
  token: string,
): string {
  let cursorWithMetric = cursor;
  let payload = Buffer.from(JSON.stringify(cursorWithMetric)).toString(
    "base64url",
  );
  if (payload.length > 1_880 && cursor.metricDefinition) {
    cursorWithMetric = {
      ...cursor,
      metricDefinition: {
        name: cursor.metricDefinition.name,
        dimensionsCount: cursor.metricDefinition.dimensionsCount,
        dimensionsTruncated: true,
        dimensions: [],
        queryableGranularities: [],
        queryableGranularitiesCount:
          cursor.metricDefinition.queryableGranularitiesCount,
        queryableGranularitiesTruncated:
          cursor.metricDefinition.queryableGranularitiesCount > 0,
      },
    };
    payload = Buffer.from(JSON.stringify(cursorWithMetric)).toString(
      "base64url",
    );
  }
  const signature = metricResultCursorSignature(payload, token).toString(
    "base64url",
  );
  return `${METRIC_RESULT_CURSOR_PREFIX}${payload}.${signature}`;
}

function decodeMetricResultCursor(
  value: string,
): DecodedMetricResultCursor | null {
  if (!value.startsWith(METRIC_RESULT_CURSOR_PREFIX)) return null;
  try {
    const signedPayload = value.slice(METRIC_RESULT_CURSOR_PREFIX.length);
    const signatureSeparator = signedPayload.lastIndexOf(".");
    if (signatureSeparator < 1) return null;
    const payload = signedPayload.slice(0, signatureSeparator);
    const signature = signedPayload.slice(signatureSeparator + 1);
    if (
      !/^[A-Za-z0-9_-]{1,1880}$/.test(payload) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature)
    ) {
      return null;
    }
    const parsed = record(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (
      typeof parsed.metricName !== "string" ||
      !parsed.metricName.trim() ||
      parsed.metricName.length > 128 ||
      typeof parsed.queryId !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(parsed.queryId) ||
      typeof parsed.connectionId !== "string" ||
      !parsed.connectionId.trim() ||
      typeof parsed.environmentId !== "string" ||
      !/^\d+$/.test(parsed.environmentId) ||
      !Number.isSafeInteger(parsed.pageNum) ||
      (parsed.pageNum as number) < 1 ||
      (parsed.pageNum as number) > 100_000 ||
      !Number.isSafeInteger(parsed.rowOffset) ||
      (parsed.rowOffset as number) < 0 ||
      (parsed.rowOffset as number) >= MAX_METRIC_QUERY_ROWS ||
      !Number.isSafeInteger(parsed.rowsBeforePage) ||
      (parsed.rowsBeforePage as number) < 0 ||
      (parsed.rowsBeforePage as number) >= MAX_METRIC_QUERY_ROWS
    ) {
      return null;
    }
    const parsedQuerySpec = metricQuerySpecSchema.safeParse(parsed.querySpec);
    if (!parsedQuerySpec.success) return null;
    const parsedMetricDefinition =
      parsed.metricDefinition === undefined
        ? undefined
        : metricDefinitionSchema.safeParse(parsed.metricDefinition);
    if (
      parsedMetricDefinition &&
      (!parsedMetricDefinition.success ||
        parsedMetricDefinition.data.name !== parsed.metricName)
    ) {
      return null;
    }
    const querySpec = parsedQuerySpec.data;
    return {
      ...(parsed as Omit<MetricResultCursor, "querySpec">),
      querySpec,
      ...(parsedMetricDefinition?.success
        ? { metricDefinition: parsedMetricDefinition.data }
        : {}),
      encodedPayload: payload,
      signature,
    };
  } catch {
    // coercion-ok: invalid cursor payloads are returned as absent and rejected by the action.
    return null;
  }
}

function verifyMetricResultCursor(
  cursor: DecodedMetricResultCursor,
  token: string,
): boolean {
  const actual = Buffer.from(cursor.signature, "base64url");
  const expected = metricResultCursorSignature(cursor.encodedPayload, token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function metricMetadataCursorSignature(payload: string, token: string): Buffer {
  return createHmac("sha256", token)
    .update(`${METRIC_METADATA_CURSOR_SIGNING_CONTEXT}${payload}`)
    .digest();
}

function encodeMetricMetadataCursor(
  cursor: MetricMetadataCursor,
  token: string,
): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  const signature = metricMetadataCursorSignature(payload, token).toString(
    "base64url",
  );
  return `${METRIC_METADATA_CURSOR_PREFIX}${payload}.${signature}`;
}

function decodeMetricMetadataCursor(
  value: string,
): DecodedMetricMetadataCursor | null {
  if (!value.startsWith(METRIC_METADATA_CURSOR_PREFIX)) return null;
  try {
    const signedPayload = value.slice(METRIC_METADATA_CURSOR_PREFIX.length);
    const signatureSeparator = signedPayload.lastIndexOf(".");
    if (signatureSeparator < 1) return null;
    const payload = signedPayload.slice(0, signatureSeparator);
    const signature = signedPayload.slice(signatureSeparator + 1);
    if (
      !/^[A-Za-z0-9_-]{1,1880}$/.test(payload) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature)
    ) {
      return null;
    }
    const parsed = record(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (
      typeof parsed.metricName !== "string" ||
      !parsed.metricName.trim() ||
      parsed.metricName.length > 128 ||
      typeof parsed.connectionId !== "string" ||
      !parsed.connectionId.trim() ||
      parsed.connectionId.length > 200 ||
      typeof parsed.environmentId !== "string" ||
      !/^\d+$/.test(parsed.environmentId) ||
      !Number.isSafeInteger(parsed.pageNum) ||
      (parsed.pageNum as number) < 2 ||
      (parsed.pageNum as number) > 100_000 ||
      !Number.isSafeInteger(parsed.searched) ||
      (parsed.searched as number) < 0 ||
      !Number.isSafeInteger(parsed.of) ||
      (parsed.of as number) < 0 ||
      (parsed.searched as number) > (parsed.of as number)
    ) {
      return null;
    }
    const querySpec = metricQuerySpecSchema.safeParse(parsed.querySpec);
    if (!querySpec.success) return null;
    return {
      ...(parsed as Omit<MetricMetadataCursor, "querySpec">),
      querySpec: querySpec.data,
      encodedPayload: payload,
      signature,
    };
  } catch {
    // coercion-ok: invalid cursor payloads are returned as absent and rejected by the action.
    return null;
  }
}

function verifyMetricMetadataCursor(
  cursor: DecodedMetricMetadataCursor,
  token: string,
): boolean {
  const actual = Buffer.from(cursor.signature, "base64url");
  const expected = metricMetadataCursorSignature(cursor.encodedPayload, token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizedMetricQuerySpec(
  groupBy: MetricQuerySpec["groupBy"] | undefined,
  timeRange: MetricQuerySpec["timeRange"],
  allTime: MetricQuerySpec["allTime"],
): MetricQuerySpec {
  const querySpec = metricQuerySpecSchema.parse({
    groupBy: groupBy ?? [],
    ...(timeRange ? { timeRange } : {}),
    ...(allTime ? { allTime } : {}),
  });
  return {
    ...querySpec,
    groupBy: [...querySpec.groupBy].sort((left, right) =>
      `${left.name}:${left.grain ?? ""}`.localeCompare(
        `${right.name}:${right.grain ?? ""}`,
      ),
    ),
  };
}

function metricDefinitionSummary(
  metricName: string,
  metric: Record<string, unknown>,
): MetricDefinition {
  const dimensions = Array.isArray(metric.dimensions)
    ? metric.dimensions
        .map(record)
        .filter((dimension) => typeof dimension.name === "string")
    : [];
  const granularities = queryableGranularities(metric.queryableGranularities);
  return {
    name: metricName,
    ...(typeof metric.description === "string"
      ? { description: metric.description }
      : {}),
    ...(typeof metric.type === "string" ? { type: metric.type } : {}),
    dimensionsCount: dimensions.length,
    dimensionsTruncated: dimensions.length > 30,
    dimensions: dimensions.slice(0, 30).map((dimension) => ({
      name: dimension.name as string,
      ...(typeof dimension.description === "string"
        ? { description: dimension.description }
        : {}),
      ...(typeof dimension.type === "string" ? { type: dimension.type } : {}),
      queryableGranularities: queryableGranularities(
        dimension.queryableGranularities,
      ),
    })),
    queryableGranularities: granularities.slice(0, 10),
    queryableGranularitiesCount: granularities.length,
    queryableGranularitiesTruncated: granularities.length > 10,
  };
}

class DbtSemanticLayerError extends Error {
  constructor(
    readonly status: DbtFailureState,
    message: string,
    readonly recoverable = true,
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
      false,
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

function fullCalendarMonthRange(
  timeRange: NonNullable<MetricQuerySpec["timeRange"]>,
): { startMonth: string; endMonth: string } | null {
  const [endYear, endMonth] = timeRange.endDate.split("-").map(Number);
  const lastDayOfEndMonth = new Date(Date.UTC(endYear!, endMonth!, 0))
    .toISOString()
    .slice(0, 10);
  if (
    timeRange.startDate !== `${timeRange.startDate.slice(0, 7)}-01` ||
    timeRange.endDate !== lastDayOfEndMonth
  ) {
    return null;
  }
  return {
    startMonth: timeRange.startDate,
    endMonth: `${timeRange.endDate.slice(0, 7)}-01`,
  };
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
        const monthRange = fullCalendarMonthRange(querySpec.timeRange);
        const filterGrain = metricGranularities.includes("DAY")
          ? "day"
          : metricGranularities.includes("MONTH") && monthRange
            ? "month"
            : null;
        if (!filterGrain) {
          fail(
            "This metric cannot apply the requested date range at a supported time grain. Use daily-capable metrics for partial-day ranges, or give month-only metrics complete calendar months.",
            {
              errorCode: "dbt_metric_grain_unsupported",
              statusCode: 400,
            },
          );
        }
        const { startDate, endDate } = querySpec.timeRange;
        const filterStart =
          filterGrain === "month" ? monthRange!.startMonth : startDate;
        const filterEnd =
          filterGrain === "month" ? monthRange!.endMonth : endDate;
        return [
          {
            sql: `{{ TimeDimension('metric_time', '${filterGrain}') }} >= '${filterStart}'`,
          },
          {
            sql: `{{ TimeDimension('metric_time', '${filterGrain}') }} <= '${filterEnd}'`,
          },
        ];
      })()
    : [];

  return { groupBy, where };
}

async function executeGraphQl(args: {
  connectionId: string;
  body: { query: string; variables: Record<string, unknown> };
  responseKind: "metadata" | "query" | "result";
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
  if (response?.truncated === true && response.ok !== false) {
    const message = {
      metadata:
        "dbt Semantic Layer truncated the metric metadata response at 500 KB. No continuation cursor is safe because the current page may be incomplete. Refine the metric name or ask the dbt owner to reduce its exposed dimensions, then retry.",
      query:
        "dbt Semantic Layer truncated the metric query creation response at 500 KB, so no query ID can be resumed. Retry with narrower filters; if it repeats, ask the dbt owner to review the metric.",
      result:
        "dbt Semantic Layer truncated the metric result at 500 KB, so this page cannot be resumed safely. Narrow the date range or grouped dimensions and start a new metric query.",
    }[args.responseKind];
    throw new DbtSemanticLayerError("provider_error", message, false);
  }
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
        false,
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
    false,
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
    "Query an exact owner-defined dbt Semantic Layer metric through the caller's workspace connection. Each scalar query must choose a bounded inclusive date range up to 366 days or explicitly set allTime:true; grouped queries require a bounded range. Daily-capable metrics accept exact dates; monthly-only metrics require complete calendar months. Unsupported filter grains return an explicit error. Returns the metric definition, querySpec, rows, and explicit permission, deployment, or connection states. Grouped time columns are returned as metric_time__<GRAIN>. It cannot run dbt jobs or accept arbitrary GraphQL.",
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
          /^(?:metric-metadata-v2\.[A-Za-z0-9_-]{1,1880}\.[A-Za-z0-9_-]{43}|metric-results-v5\.[A-Za-z0-9_-]{1,1880}\.[A-Za-z0-9_-]{43})$/,
        )
        .optional()
        .describe(
          "Continue an exact-name metadata search or metric result page; signed cursors preserve the search or query, connection, environment, grouping, and time scope",
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
          `Inclusive metric_time date range in YYYY-MM-DD format; maximum ${MAX_METRIC_QUERY_DAYS} days. Metrics with MONTH but no DAY granularity require a full calendar-month range. Required for grouped queries and one of timeRange or allTime:true is required for scalar queries.`,
        ),
      allTime: z
        .literal(true)
        .optional()
        .describe(
          "Set to true only when the metric should cover all available time; scalar queries must pass this or a bounded timeRange, and it cannot be combined with timeRange.",
        ),
    })
    .strict()
    .superRefine(
      ({ queryId, nextPage, groupBy, timeRange, allTime }, context) => {
        const metadataCursorContinuation = nextPage?.startsWith(
          METRIC_METADATA_CURSOR_PREFIX,
        );
        const hasQueryScope =
          (groupBy?.length ?? 0) > 0 || Boolean(timeRange) || Boolean(allTime);
        if (!queryId && !(metadataCursorContinuation && !hasQueryScope)) {
          const hasInvalidTimeScope =
            (Boolean(timeRange) && Boolean(allTime)) ||
            (groupBy?.length
              ? !timeRange || Boolean(allTime)
              : !timeRange && !allTime);
          if (hasInvalidTimeScope) {
            context.addIssue({
              code: "custom",
              path: ["timeRange"],
              message: groupBy?.length
                ? "Dimension-grouped MetricFlow queries require a bounded date range and cannot use allTime."
                : "Choose exactly one of a bounded timeRange or allTime:true for a scalar metric query.",
            });
          }
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
          nextPage?.startsWith(METRIC_RESULT_CURSOR_PREFIX),
        );
        if (queryId && !resultCursor) {
          context.addIssue({
            code: "custom",
            path: ["nextPage"],
            message:
              "A queryId continuation requires its matching MetricFlow result-page cursor so the original grouping and time scope are preserved.",
          });
        }
        if (!queryId && resultCursor) {
          context.addIssue({
            code: "custom",
            path: ["queryId"],
            message: "A MetricFlow result page requires its queryId.",
          });
        }
        if (queryId && ((groupBy?.length ?? 0) > 0 || timeRange || allTime)) {
          context.addIssue({
            code: "custom",
            path: ["queryId"],
            message:
              "Continue a MetricFlow query with its queryId and nextPage cursor only; the cursor preserves its grouping and explicit time scope.",
          });
        }
      },
    ),
  outputSchema: queryMetricOutputSchema,
  readOnly: true,
  parallelSafe: true,
  grounding: true,
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
    allTime,
  }) => {
    const hasRequestedMetricQueryScope =
      (groupBy?.length ?? 0) > 0 || Boolean(timeRange) || Boolean(allTime);
    const requestedMetadataQuerySpec = hasRequestedMetricQueryScope
      ? normalizedMetricQuerySpec(groupBy, timeRange, allTime)
      : null;
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
    const isMetricResultCursor = nextPage?.startsWith(
      METRIC_RESULT_CURSOR_PREFIX,
    );
    const resultCursor = isMetricResultCursor
      ? decodeMetricResultCursor(nextPage!)
      : null;
    if (isMetricResultCursor && !resultCursor) {
      fail("The metric result cursor is invalid.", {
        errorCode: "invalid_metric_result_cursor",
        statusCode: 400,
      });
    }
    const isMetricMetadataCursor = nextPage?.startsWith(
      METRIC_METADATA_CURSOR_PREFIX,
    );
    const metadataCursor = isMetricMetadataCursor
      ? decodeMetricMetadataCursor(nextPage!)
      : null;
    if (isMetricMetadataCursor && !metadataCursor) {
      fail("The metric metadata cursor is invalid.", {
        errorCode: "invalid_metric_metadata_cursor",
        statusCode: 400,
      });
    }
    const selectedConnectionId =
      connectionId ??
      resultCursor?.connectionId ??
      metadataCursor?.connectionId;
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

    const requestedQuerySpec = resultCursor
      ? resultCursor.querySpec
      : (metadataCursor?.querySpec ??
        requestedMetadataQuerySpec ??
        metricQuerySpecSchema.parse({
          groupBy: groupBy ?? [],
          ...(timeRange ? { timeRange } : {}),
          ...(allTime ? { allTime } : {}),
        }));
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

    if (resultCursor && !verifyMetricResultCursor(resultCursor, token.value)) {
      fail("The metric result cursor signature is invalid.", {
        errorCode: "invalid_metric_result_cursor",
        statusCode: 400,
      });
    }
    if (
      metadataCursor &&
      (!verifyMetricMetadataCursor(metadataCursor, token.value) ||
        metadataCursor.metricName !== metricName.trim().toLowerCase() ||
        metadataCursor.connectionId !== selected.id ||
        metadataCursor.environmentId !== environmentId ||
        JSON.stringify(metadataCursor.querySpec) !==
          JSON.stringify(
            requestedMetadataQuerySpec ?? metadataCursor.querySpec,
          ))
    ) {
      fail(
        "The metric metadata cursor is invalid or belongs to another metric, connection, or environment.",
        {
          errorCode: "invalid_metric_metadata_cursor",
          statusCode: 400,
        },
      );
    }

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 12_000);
    let activeQueryId = queryId;
    let initialResultPageCursor: string | undefined;
    let activeMetricDefinition = resultCursor?.metricDefinition;
    try {
      let metric: Record<string, unknown> = { name: metricName };
      if (!activeQueryId) {
        const exactMatches: Record<string, unknown>[] = [];
        const startPage = metadataCursor?.pageNum ?? 1;
        let pageCount = startPage - 1;
        let totalItems = metadataCursor?.of ?? 0;
        let totalPages = 0;
        let itemsSeen = 0;
        const finalPage = startPage + MAX_METADATA_PAGES - 1;
        while (pageCount < finalPage) {
          const lookup = await executeGraphQl({
            connectionId: selected.id,
            signal: controller.signal,
            responseKind: "metadata",
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
            !Number.isSafeInteger(page.totalItems) ||
            page.totalItems < 0 ||
            typeof page.totalPages !== "number" ||
            !Number.isSafeInteger(page.totalPages) ||
            page.totalPages < 0 ||
            page.totalPages > 100_000
          ) {
            fail(
              "dbt Semantic Layer returned incomplete metric metadata pagination.",
              {
                errorCode: "dbt_invalid_metadata_page",
                statusCode: 502,
              },
            );
          }
          if (metadataCursor && page.totalItems !== metadataCursor.of) {
            fail(
              "The dbt metric catalog changed during pagination. Restart the exact-name search.",
              {
                errorCode: "dbt_metadata_cursor_stale",
                statusCode: 409,
              },
            );
          }
          const items = page.items;
          pageCount += 1;
          itemsSeen += items.length;
          totalItems = page.totalItems;
          totalPages = page.totalPages;
          exactMatches.push(
            ...items.map(record).filter((item) => item.name === metricName),
          );
          if (exactMatches.length || pageCount >= totalPages) break;
        }
        const searched = Math.min(
          totalItems,
          (metadataCursor?.searched ?? 0) + itemsSeen,
        );
        if (!exactMatches.length && pageCount < totalPages) {
          return {
            status: "metadata_truncated",
            metricName,
            searched,
            of: totalItems,
            truncated: true,
            nextPage: encodeMetricMetadataCursor(
              {
                metricName: metricName.trim().toLowerCase(),
                connectionId: selected.id,
                environmentId,
                pageNum: pageCount + 1,
                searched,
                of: totalItems,
                querySpec: requestedQuerySpec,
              },
              token.value,
            ),
            message:
              "The dbt metric search reached its page limit. Refine the exact metric name or continue from the next metadata page.",
          };
        }
        if (exactMatches.length !== 1) {
          if (exactMatches.length === 0) {
            const manifest = await executeGraphQl({
              connectionId: selected.id,
              signal: controller.signal,
              responseKind: "metadata",
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
            searched,
            of: totalItems,
          };
        }
        metric = exactMatches[0]!;
        activeMetricDefinition = metricDefinitionSummary(metricName, metric);
        if (!activeQueryId) {
          const metricQuery = validateMetricQuerySpec(metric, activeQuerySpec);
          const created = await executeGraphQl({
            connectionId: selected.id,
            signal: controller.signal,
            responseKind: "query",
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

      initialResultPageCursor = encodeMetricResultCursor(
        {
          metricName,
          queryId: activeQueryId,
          connectionId: selected.id,
          environmentId,
          pageNum: 1,
          rowOffset: 0,
          rowsBeforePage: 0,
          querySpec: activeQuerySpec,
          ...(activeMetricDefinition
            ? { metricDefinition: activeMetricDefinition }
            : {}),
        },
        token.value,
      );
      const resultPageNum = resultCursor?.pageNum ?? 1;
      const resultRowOffset = resultCursor?.rowOffset ?? 0;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        const response = await executeGraphQl({
          connectionId: selected.id,
          signal: controller.signal,
          responseKind: "result",
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
            totalPages > 100_000
          ) {
            throw new DbtSemanticLayerError(
              "provider_error",
              "MetricFlow marked the query successful but returned missing or invalid pagination metadata. Start a new metric query after the dbt result is repaired.",
              false,
            );
          }
          if (totalPages < resultPageNum) {
            throw new DbtSemanticLayerError(
              "provider_error",
              "The MetricFlow result cursor points beyond the last available page. Start a new metric query.",
              false,
            );
          }
          const rowsBeforePage = resultCursor?.rowsBeforePage ?? 0;
          const queryRowsRemaining = MAX_METRIC_QUERY_ROWS - rowsBeforePage;
          const pageRows = rows.slice(0, queryRowsRemaining);
          if (resultRowOffset > 0 && resultRowOffset >= pageRows.length) {
            throw new DbtSemanticLayerError(
              "provider_error",
              "dbt Semantic Layer returned an invalid metric result page.",
              false,
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
              ? encodeMetricResultCursor(
                  {
                    metricName,
                    queryId: activeQueryId,
                    connectionId: selected.id,
                    environmentId,
                    pageNum: resultPageNum,
                    rowOffset: nextRowOffset,
                    rowsBeforePage,
                    querySpec: activeQuerySpec,
                    ...(activeMetricDefinition
                      ? { metricDefinition: activeMetricDefinition }
                      : {}),
                  },
                  token.value,
                )
              : resultPageNum < totalPages && !queryRowCapReached
                ? encodeMetricResultCursor(
                    {
                      metricName,
                      queryId: activeQueryId,
                      connectionId: selected.id,
                      environmentId,
                      pageNum: resultPageNum + 1,
                      rowOffset: 0,
                      rowsBeforePage: rowsBeforeNextPage,
                      querySpec: activeQuerySpec,
                      ...(activeMetricDefinition
                        ? { metricDefinition: activeMetricDefinition }
                        : {}),
                    },
                    token.value,
                  )
                : undefined;
          return {
            status: "success",
            ...(activeMetricDefinition
              ? { metric: activeMetricDefinition }
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
            false,
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
        ...(activeMetricDefinition ? { metric: activeMetricDefinition } : {}),
        message:
          "The MetricFlow query is still running. Call this action again with the same metricName, queryId, and returned nextPage cursor to continue polling.",
        connection: { id: selected.id, label: selected.label },
        source: "dbt-semantic-layer",
      };
    } catch (error) {
      if (error instanceof DbtSemanticLayerError) {
        const hasRecovery =
          error.recoverable &&
          Boolean(activeQueryId && initialResultPageCursor);
        const recovery = hasRecovery
          ? {
              queryId: activeQueryId!,
              nextPage: resultCursor ? nextPage! : initialResultPageCursor!,
              querySpec: activeQuerySpec,
              ...(activeMetricDefinition
                ? { metric: activeMetricDefinition }
                : {}),
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
            ...(activeMetricDefinition
              ? { metric: activeMetricDefinition }
              : {}),
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
            ...(activeMetricDefinition
              ? { metric: activeMetricDefinition }
              : {}),
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

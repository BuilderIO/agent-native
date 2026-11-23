import { fail } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { z } from "zod";

export type DbtSemanticClientOptions = Readonly<{
  endpoint: string;
  environmentId: string;
  token: string;
  signal?: AbortSignal;
  deadline?: number;
}>;
export type DbtSemanticOperation = "list" | "start" | "read";
type ProtocolRequestContext = DbtSemanticClientOptions & {
  markDispatched: () => void;
  activeSignal?: AbortSignal;
  activeDeadline?: number;
};
export type DbtMetricSelection = z.input<typeof dbtMetricQuerySelectionSchema>;

function checkedEndpoint(raw: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return fail("Enter a valid dbt Semantic Layer endpoint.", {
      errorCode: "dbt_semantic_configuration_invalid",
      statusCode: 422,
    });
  }
  const host = endpoint.hostname;
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== "/api/graphql" ||
    endpoint.search ||
    endpoint.hash ||
    !host.split(".").includes("semantic-layer") ||
    (!host.endsWith(".dbt.com") && !host.endsWith(".getdbt.com"))
  )
    return fail("Enter a valid dbt Semantic Layer endpoint.", {
      errorCode: "dbt_semantic_configuration_invalid",
      statusCode: 422,
    });
  return endpoint.href;
}
function assertControl(context: ProtocolRequestContext): void {
  if (context.signal?.aborted)
    return fail("The dbt Semantic Layer request was cancelled.", {
      errorCode: "dbt_semantic_cancelled",
      statusCode: 499,
    });
  if (
    context.activeSignal?.aborted ||
    (context.activeDeadline !== undefined &&
      Date.now() >= context.activeDeadline) ||
    (context.deadline !== undefined && Date.now() >= context.deadline)
  )
    return fail("The dbt Semantic Layer request exceeded its deadline.", {
      errorCode: "dbt_semantic_timeout",
      statusCode: 504,
    });
}
function requestSignal(context: ProtocolRequestContext): AbortSignal {
  if (
    context.deadline !== undefined &&
    (!Number.isSafeInteger(context.deadline) || context.deadline <= 0)
  )
    return fail("Enter a valid request deadline.", {
      errorCode: "dbt_semantic_configuration_invalid",
      statusCode: 422,
    });
  assertControl(context);
  context.activeDeadline = Math.min(
    Date.now() + 20_000,
    context.deadline ?? Infinity,
  );
  const timeout = AbortSignal.timeout(
    Math.max(1, context.activeDeadline - Date.now()),
  );
  context.activeSignal = context.signal
    ? AbortSignal.any([context.signal, timeout])
    : timeout;
  assertControl(context);
  return context.activeSignal;
}

// Create a new client only after this request authorizes the exact connection
// and resolves its token. The client never reads credentials or retries a call.
export function createDbtSemanticClient(options: DbtSemanticClientOptions) {
  const snapshot = { ...options };
  async function execute<T>(
    operation: DbtSemanticOperation,
    run: (context: ProtocolRequestContext) => Promise<T>,
  ): Promise<T> {
    let dispatched = false;
    const context: ProtocolRequestContext = {
      ...snapshot,
      markDispatched: () => {
        dispatched = true;
      },
    };
    try {
      const result = await run(context);
      assertControl(context);
      return result;
    } catch (error) {
      const inputInvalid = error instanceof z.ZodError;
      const known =
        error &&
        typeof error === "object" &&
        "errorCode" in error &&
        typeof error.errorCode === "string" &&
        error.errorCode.startsWith("dbt_semantic_") &&
        error instanceof Error;
      return fail(
        inputInvalid
          ? "Enter valid dbt metric query inputs."
          : known
            ? error.message
            : "The dbt Semantic Layer request could not complete. Check the connection and try again.",
        {
          errorCode: inputInvalid
            ? "dbt_semantic_input_invalid"
            : known && typeof error.errorCode === "string"
              ? error.errorCode
              : "dbt_semantic_unavailable",
          statusCode: inputInvalid
            ? 422
            : known &&
                "statusCode" in error &&
                typeof error.statusCode === "number"
              ? error.statusCode
              : 503,
          details: {
            operation,
            requestDispatched: dispatched,
            ...(operation === "start"
              ? { queryOutcome: dispatched ? "unknown" : "not-dispatched" }
              : {}),
          },
        },
      );
    }
  }
  return {
    listMetrics: (
      paging: { pageNum?: number; pageSize?: number; search?: string } = {},
    ) =>
      execute("list", (context) =>
        listDbtMetricsWithToken(context, snapshot.token, paging),
      ),
    startQuery: (selection: DbtMetricSelection) =>
      execute("start", (context) =>
        startDbtMetricQueryWithToken(context, snapshot.token, selection),
      ),
    readQueryPage: (input: { queryId: string; pageNum: number }) =>
      execute("read", (context) =>
        readDbtMetricQueryPageWithToken(context, snapshot.token, input),
      ),
  };
}
export type DbtSemanticClient = ReturnType<typeof createDbtSemanticClient>;

// Server transport only. Callers must authorize the selected connection,
// resolve its own token and bind query IDs to that connection and requestor.
const name = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(256);
const grain = z.enum([
  "SECOND",
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
]);
const pageNumber = z.number().int().min(1).max(2_147_483_647);
export const dbtMetricQuerySelectionSchema = z
  .object({
    metrics: z
      .array(z.object({ name, alias: name.optional() }).strict())
      .min(1)
      .max(100),
    groupBy: z
      .array(z.object({ name, grain: grain.optional() }).strict())
      .max(100)
      .optional(),
    where: z
      .array(z.object({ sql: z.string().min(1).max(8_000) }).strict())
      .max(100)
      .optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();
const metricSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(20_000).nullable(),
  type: z.string().max(100),
  dimensions: z.array(
    z.object({
      name: z.string().min(1).max(256),
      description: z.string().max(20_000).nullable(),
      type: z.string().max(100),
      queryableGranularities: z.array(grain),
    }),
  ),
  queryableGranularities: z.array(grain),
});
const cellValue = z.union([
  z.string().max(100_000),
  z
    .number()
    .finite()
    .refine((value) => !Number.isInteger(value) || Number.isSafeInteger(value)),
  z.boolean(),
  z.null(),
]);
const tableSchema = z.object({
  schema: z.object({
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(256),
          type: z.string().max(100),
        }),
      )
      .min(1)
      .max(1_000),
  }),
  data: z.array(z.record(z.string(), cellValue)).max(1_024),
});
const queryPageSchema = z.object({
  status: z.enum([
    "PENDING",
    "QUEUED",
    "RUNNING",
    "COMPILED",
    "SUCCESSFUL",
    "FAILED",
  ]),
  error: z.string().nullable(),
  totalPages: z.number().int().min(0).max(2_147_483_647).nullable(),
  sql: z.string().max(1_000_000).nullable(),
  jsonResult: z.string().nullable(),
});

function invalidResponse(): never {
  return fail(
    "dbt returned an incomplete or unreadable Semantic Layer response.",
    { errorCode: "dbt_semantic_response_invalid", statusCode: 502 },
  );
}
function unavailable(): never {
  return fail(
    "The dbt Semantic Layer request could not complete. Check the connection and try again.",
    { errorCode: "dbt_semantic_unavailable", statusCode: 503 },
  );
}
function parsed<T>(value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (!result.success) return invalidResponse();
  return result.data;
}

async function dispatchRequest(
  endpoint: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let abandoned = false;
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    abandoned = true;
    rejectAbort(new Error("Semantic Layer request aborted"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  // DNS and dispatcher preparation also need a bound, before native fetch
  // begins observing its signal. Keep the SSRF guard on that same request.
  const pending = Promise.resolve().then(() => {
    if (signal.aborted) throw new Error("Semantic Layer request aborted");
    return ssrfSafeFetch(endpoint, init, {
      httpsOnly: true,
      followRedirects: false,
      requireDispatcher: true,
    });
  });
  void pending.then(
    (late) => {
      if (abandoned) void late.body?.cancel().catch(() => {});
    },
    () => {},
  );
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function request(
  config: ProtocolRequestContext,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  if (!/^[1-9][0-9]*$/.test(config.environmentId) || !token.trim())
    return fail(
      "Configure a dbt environment and its connection token before querying metrics.",
      { errorCode: "dbt_semantic_configuration_invalid", statusCode: 422 },
    );
  const endpoint = checkedEndpoint(config.endpoint);
  const signal = requestSignal(config);
  let response: Response;
  try {
    config.markDispatched();
    response = await dispatchRequest(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { ...variables, environmentId: config.environmentId },
        }),
        signal,
      },
      signal,
    );
  } catch {
    assertControl(config);
    return unavailable();
  }
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    assertControl(config);
  }
  if (!response.ok) {
    // A provider refusal must not wait for a producer's cancellation promise.
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      return fail(
        "The connection token cannot access this dbt Semantic Layer environment.",
        {
          errorCode: "dbt_semantic_access_denied",
          statusCode: response.status,
        },
      );
    if (response.status === 429)
      return fail("dbt is rate limiting metric requests. Try again shortly.", {
        errorCode: "dbt_semantic_rate_limited",
        statusCode: 429,
      });
    return unavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) return invalidResponse();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0,
    oversized = false;
  let rejectAbort: (reason: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    // Cancellation may itself fail; preserve the caller cancellation/timeout verdict.
    void reader.cancel().catch(() => {});
    rejectAbort(new Error("Semantic Layer request aborted"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1_024 * 1_024) {
        oversized = true;
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    assertControl(config);
  } catch {
    assertControl(config);
    return unavailable();
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Do not let a stalled producer's cancel promise extend the byte-limit budget.
    if (oversized) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (oversized) return invalidResponse();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return invalidResponse();
  }
  const envelope = parsed(
    payload,
    z.object({ data: z.unknown(), errors: z.array(z.unknown()).optional() }),
  );
  if (envelope.errors?.length) return unavailable();
  return envelope.data;
}

async function listDbtMetricsWithToken(
  config: ProtocolRequestContext,
  token: string,
  options: { pageNum?: number; pageSize?: number; search?: string },
) {
  const paging = z
    .object({
      pageNum: pageNumber.default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      search: z.string().max(500).optional(),
    })
    .strict()
    .parse(options);
  const data = await request(
    config,
    token,
    "query MetricCatalog($environmentId: BigInt!, $pageNum: Int!, $pageSize: Int!, $search: String) { metricsPaginated(environmentId: $environmentId, pageNum: $pageNum, pageSize: $pageSize, search: $search) { items { name description type dimensions { name description type queryableGranularities } queryableGranularities } pageNum pageSize totalItems totalPages } }",
    paging,
  );
  const { metricsPaginated: result } = parsed(
    data,
    z.object({
      metricsPaginated: z.object({
        items: z.array(metricSchema),
        pageNum: pageNumber,
        pageSize: z.number().int().positive(),
        totalItems: z.number().int().min(0),
        totalPages: z.number().int().min(0),
      }),
    }),
  );
  const totalPages = Math.ceil(result.totalItems / paging.pageSize);
  const expectedItems =
    result.totalItems === 0
      ? 0
      : Math.min(
          paging.pageSize,
          result.totalItems - (paging.pageNum - 1) * paging.pageSize,
        );
  if (
    result.pageNum !== paging.pageNum ||
    result.pageSize !== paging.pageSize ||
    result.totalPages !== totalPages ||
    paging.pageNum > Math.max(1, totalPages) ||
    result.items.length !== expectedItems
  )
    return invalidResponse();
  return result;
}

async function startDbtMetricQueryWithToken(
  config: ProtocolRequestContext,
  token: string,
  selection: z.input<typeof dbtMetricQuerySelectionSchema>,
) {
  const variables = dbtMetricQuerySelectionSchema.parse(selection);
  const data = await request(
    config,
    token,
    "mutation RunMetricQuery($environmentId: BigInt!, $metrics: [MetricInput!]!, $groupBy: [GroupByInput!], $where: [WhereInput!], $limit: Int) { createQuery(environmentId: $environmentId, metrics: $metrics, groupBy: $groupBy, where: $where, limit: $limit) { queryId } }",
    variables,
  );
  return parsed(
    data,
    z.object({
      createQuery: z.object({ queryId: z.string().min(1).max(500) }),
    }),
  ).createQuery;
}

async function readDbtMetricQueryPageWithToken(
  config: ProtocolRequestContext,
  token: string,
  input: { queryId: string; pageNum: number },
) {
  const variables = z
    .object({ queryId: z.string().min(1).max(500), pageNum: pageNumber })
    .strict()
    .parse(input);
  const data = await request(
    config,
    token,
    "query MetricQueryPage($environmentId: BigInt!, $queryId: String!, $pageNum: Int!) { query(environmentId: $environmentId, queryId: $queryId, pageNum: $pageNum) { status error totalPages sql jsonResult(orient: TABLE, encoded: false) } }",
    variables,
  );
  const result = parsed(data, z.object({ query: queryPageSchema })).query;
  if (result.status === "FAILED")
    return fail(
      "The dbt metric query failed. Review the selected metrics, dimensions and filters.",
      { errorCode: "dbt_semantic_query_failed", statusCode: 502 },
    );
  if (result.status !== "SUCCESSFUL")
    return {
      queryId: input.queryId,
      status: result.status,
      pageNum: input.pageNum,
    };
  if (
    result.error ||
    result.totalPages === null ||
    result.jsonResult === null ||
    input.pageNum > Math.max(1, result.totalPages)
  )
    return invalidResponse();
  let rawTable: unknown;
  try {
    rawTable = JSON.parse(result.jsonResult);
  } catch {
    return invalidResponse();
  }
  const table = parsed(rawTable, tableSchema);
  const fields = table.schema.fields;
  const names = new Set(fields.map((field) => field.name));
  if (
    names.size !== fields.length ||
    (result.totalPages === 0 && table.data.length !== 0) ||
    table.data.some(
      (row) =>
        Object.keys(row).length !== names.size ||
        Object.keys(row).some((key) => !names.has(key)),
    )
  )
    return invalidResponse();
  return {
    queryId: input.queryId,
    status: result.status,
    pageNum: input.pageNum,
    totalPages: result.totalPages,
    sql: result.sql,
    fields,
    rows: table.data,
  };
}

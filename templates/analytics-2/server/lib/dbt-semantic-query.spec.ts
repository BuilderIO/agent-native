import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.fetch,
}));
vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
const {
  listDbtMetricsWithToken,
  startDbtMetricQueryWithToken,
  readDbtMetricQueryPageWithToken,
} = await import("./dbt-semantic-query.js");
const config = {
  hasDbtMetadata: true,
  dbtVersion: "current",
  dbtEnvironmentId: "42",
  dbtCloudHostname: "cloud.getdbt.com",
};
const token = "flagged-semantic-credential";
const metric = {
  name: "order_total",
  description: "Total orders",
  type: "SIMPLE",
  dimensions: [
    {
      name: "metric_time",
      type: "TIME",
      description: null,
      queryableGranularities: ["DAY"],
    },
  ],
  queryableGranularities: ["DAY"],
};
function answer(data: unknown) {
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ data }), { status: 200 }),
  );
}
function page(query: Record<string, unknown> = {}) {
  answer({
    query: {
      status: "SUCCESSFUL",
      error: null,
      totalPages: 1,
      sql: "select order_total",
      jsonResult: JSON.stringify({
        schema: {
          fields: [{ name: "order_total", type: "number" }],
          primaryKey: [],
        },
        data: [{ order_total: 12 }],
      }),
      ...query,
    },
  });
}
beforeEach(() => vi.clearAllMocks());
describe("connection-token Semantic Layer transport", () => {
  it("uses Bearer on the secure region endpoint and passes metadata pagination explicitly", async () => {
    answer({
      metricsPaginated: {
        items: [metric],
        pageNum: 2,
        pageSize: 1,
        totalItems: 2,
        totalPages: 2,
      },
    });
    const result = await listDbtMetricsWithToken(
      { ...config, dbtCloudHostname: "account.us1.dbt.com" },
      token,
      { pageNum: 2, pageSize: 1 },
    );
    expect(result.items[0]?.name).toBe("order_total");
    expect(result.totalItems).toBe(2);
    const [url, options, guard] = mocks.fetch.mock.calls[0]!;
    expect(url).toBe("https://account.semantic-layer.us1.dbt.com/api/graphql");
    expect(options.headers.Authorization).toBe("Bearer " + token);
    expect(JSON.parse(options.body).variables).toMatchObject({
      environmentId: "42",
      pageNum: 2,
      pageSize: 1,
    });
    expect(guard).toEqual({
      httpsOnly: true,
      followRedirects: false,
      requireDispatcher: true,
    });
  });
  it("keeps metrics and filters in GraphQL variables, never executable query text", async () => {
    answer({ createQuery: { queryId: "query-one" } });
    expect(
      await startDbtMetricQueryWithToken(config, token, {
        metrics: [{ name: "order_total" }],
        groupBy: [{ name: "metric_time", grain: "MONTH" }],
        where: [{ sql: "{{ Dimension('metric_time') }} >= '2026-01-01'" }],
        limit: 10,
      }),
    ).toEqual({ queryId: "query-one" });
    const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
    expect(body.query).not.toContain("2026-01-01");
    expect(body.variables.where[0].sql).toContain("2026-01-01");
  });
  it("returns explicit page metadata and decoded table rows", async () => {
    page();
    expect(
      await readDbtMetricQueryPageWithToken(config, token, {
        queryId: "query-one",
        pageNum: 1,
      }),
    ).toMatchObject({
      status: "SUCCESSFUL",
      totalPages: 1,
      pageNum: 1,
      rows: [{ order_total: 12 }],
      fields: [{ name: "order_total", type: "number" }],
    });
  });
  it("does not treat a running query as an empty success", async () => {
    page({ status: "RUNNING", totalPages: null, jsonResult: null, sql: null });
    expect(
      await readDbtMetricQueryPageWithToken(config, token, {
        queryId: "query-one",
        pageNum: 1,
      }),
    ).toEqual({ queryId: "query-one", status: "RUNNING", pageNum: 1 });
  });
  it("keeps page1025 reachable instead of truncating the result to a first page", async () => {
    page({ totalPages: 1025 });
    await expect(
      readDbtMetricQueryPageWithToken(config, token, {
        queryId: "query-one",
        pageNum: 1025,
      }),
    ).resolves.toMatchObject({ pageNum: 1025, totalPages: 1025 });
    expect(
      JSON.parse(mocks.fetch.mock.calls[0]![1].body).variables.pageNum,
    ).toBe(1025);
  });
  it.each([401, 403, 429, 503])(
    "refuses provider %s without echoing its response or the token",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(new Response(token, { status }));
      await expect(
        listDbtMetricsWithToken(config, token, {}),
      ).rejects.toMatchObject({
        errorCode:
          status === 401 || status === 403
            ? "dbt_semantic_access_denied"
            : status === 429
              ? "dbt_semantic_rate_limited"
              : "dbt_semantic_unavailable",
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects GraphQL errors even alongside usable-looking data", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { createQuery: { queryId: "partial" } },
          errors: [{ message: token }],
        }),
      ),
    );
    await expect(
      startDbtMetricQueryWithToken(config, token, {
        metrics: [{ name: "order_total" }],
      }),
    ).rejects.toThrow("could not complete");
  });
  it("refuses malformed or incomplete successful output", async () => {
    page({ jsonResult: null });
    await expect(
      readDbtMetricQueryPageWithToken(config, token, {
        queryId: "query-one",
        pageNum: 1,
      }),
    ).rejects.toMatchObject({ errorCode: "dbt_semantic_response_invalid" });
  });
  it("refuses a failed query without returning its SQL or provider error", async () => {
    page({ status: "FAILED", error: token });
    await expect(
      readDbtMetricQueryPageWithToken(config, token, {
        queryId: "query-one",
        pageNum: 1,
      }),
    ).rejects.toMatchObject({ errorCode: "dbt_semantic_query_failed" });
  });
  it.each([
    { hasDbtMetadata: false },
    { dbtVersion: "legacy" },
    { dbtEnvironmentId: "" },
    { dbtCloudHostname: "http://localhost" },
  ])(
    "refuses unusable connection configuration before requesting: %j",
    async (change) => {
      await expect(
        listDbtMetricsWithToken({ ...config, ...change }, token, {}),
      ).rejects.toThrow();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("refuses blank credentials and invalid selections before requesting", async () => {
    await expect(listDbtMetricsWithToken(config, "", {})).rejects.toThrow();
    await expect(
      startDbtMetricQueryWithToken(config, token, { metrics: [] }),
    ).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("bounds streamed bytes even when content-length is absent", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(" ".repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(
      listDbtMetricsWithToken(config, token, {}),
    ).rejects.toMatchObject({ errorCode: "dbt_semantic_response_invalid" });
  });
});

it("paginates beyond the100-metric request bound without dropping metric101", async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => ({
    ...metric,
    name: "metric_" + i,
  }));
  answer({
    metricsPaginated: {
      items: hundred,
      pageNum: 1,
      pageSize: 100,
      totalItems: 101,
      totalPages: 2,
    },
  });
  const first = await listDbtMetricsWithToken(config, token, {
    pageNum: 1,
    pageSize: 100,
  });
  answer({
    metricsPaginated: {
      items: [{ ...metric, name: "metric_100" }],
      pageNum: 2,
      pageSize: 100,
      totalItems: 101,
      totalPages: 2,
    },
  });
  const last = await listDbtMetricsWithToken(config, token, {
    pageNum: 2,
    pageSize: 100,
  });
  expect(first.items).toHaveLength(100);
  expect(last.items[0]?.name).toBe("metric_100");
  expect(last.totalPages).toBe(2);
});
it("sanitizes provider exceptions and refuses redirects without a retry", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error(token));
  await expect(listDbtMetricsWithToken(config, token, {})).rejects.not.toThrow(
    token,
  );
  mocks.fetch.mockResolvedValueOnce(
    new Response(token, {
      status: 302,
      headers: { Location: "https://unrelated.invalid" },
    }),
  );
  await expect(listDbtMetricsWithToken(config, token, {})).rejects.not.toThrow(
    token,
  );
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it.each(["metadata", "alpha-metadata"])(
  "preserves an account prefix containing metadata: %s",
  async (account) => {
    answer({
      metricsPaginated: {
        items: [],
        pageNum: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 0,
      },
    });
    await listDbtMetricsWithToken(
      { ...config, dbtCloudHostname: account + ".us1.dbt.com" },
      token,
      {},
    );
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe(
      "https://" + account + ".semantic-layer.us1.dbt.com/api/graphql",
    );
  },
);

it("refuses unsafe JSON integers instead of silently rounding metric values", async () => {
  page({
    jsonResult:
      '{"schema":{"fields":[{"name":"order_total","type":"integer"}]},"data":[{"order_total":9007199254740993}]}',
  });
  await expect(
    readDbtMetricQueryPageWithToken(config, token, {
      queryId: "query-one",
      pageNum: 1,
    }),
  ).rejects.toMatchObject({ errorCode: "dbt_semantic_response_invalid" });
});
it("requires column metadata even for an empty metric result", async () => {
  page({ jsonResult: JSON.stringify({ schema: { fields: [] }, data: [] }) });
  await expect(
    readDbtMetricQueryPageWithToken(config, token, {
      queryId: "query-one",
      pageNum: 1,
    }),
  ).rejects.toMatchObject({ errorCode: "dbt_semantic_response_invalid" });
});

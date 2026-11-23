import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.fetch,
}));
vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("./warehouse-dbt.js", () => {
  throw new Error(
    "Native protocol must not import the legacy warehouse module",
  );
});
const { createDbtSemanticClient } = await import("./dbt-semantic-protocol.js");
const options = {
  endpoint: "https://semantic-layer.cloud.getdbt.com/api/graphql",
  environmentId: "42",
  token: "flagged-semantic-credential",
};
function result(data: unknown) {
  return new Response(JSON.stringify({ data }));
}
function emptyCatalog() {
  return result({
    metricsPaginated: {
      items: [],
      pageNum: 1,
      pageSize: 25,
      totalItems: 0,
      totalPages: 0,
    },
  });
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe("native-injectable Semantic Layer protocol", () => {
  it("uses the injected dedicated endpoint and environment without loading legacy credentials", async () => {
    mocks.fetch.mockResolvedValueOnce(emptyCatalog());
    await createDbtSemanticClient({
      ...options,
      endpoint: "https://semantic-layer.cloud.account.getdbt.com/api/graphql",
      environmentId: "999",
    }).listMetrics({});
    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(url).toBe(
      "https://semantic-layer.cloud.account.getdbt.com/api/graphql",
    );
    expect(JSON.parse(init.body).variables.environmentId).toBe("999");
    expect(init.headers.Authorization).toBe("Bearer " + options.token);
  });
  it.each([
    "http://semantic-layer.cloud.getdbt.com/api/graphql",
    "https://semantic-layer.cloud.getdbt.com.attacker.invalid/api/graphql",
    "https://user:pass@semantic-layer.cloud.getdbt.com/api/graphql",
    "https://semantic-layer.cloud.getdbt.com/other",
    "https://semantic-layer.cloud.getdbt.com/api/graphql?token=hidden",
  ])(
    "rejects an unsafe injected endpoint before dispatch: %s",
    async (endpoint) => {
      await expect(
        createDbtSemanticClient({ ...options, endpoint }).listMetrics({}),
      ).rejects.toMatchObject({
        errorCode: "dbt_semantic_configuration_invalid",
        details: { requestDispatched: false },
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("refuses already-aborted calls without exposing the abort reason or starting a mutation", async () => {
    const controller = new AbortController();
    controller.abort(options.token);
    await expect(
      createDbtSemanticClient({
        ...options,
        signal: controller.signal,
      }).startQuery({ metrics: [{ name: "orders" }] }),
    ).rejects.toMatchObject({
      errorCode: "dbt_semantic_cancelled",
      details: { requestDispatched: false, queryOutcome: "not-dispatched" },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("honors an expired absolute deadline before dispatch", async () => {
    await expect(
      createDbtSemanticClient({
        ...options,
        deadline: Date.now() - 1,
      }).listMetrics({}),
    ).rejects.toMatchObject({
      errorCode: "dbt_semantic_timeout",
      details: { requestDispatched: false },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not reset the caller's absolute deadline between reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const client = createDbtSemanticClient({
      ...options,
      deadline: Date.now() + 100,
    });
    mocks.fetch.mockResolvedValueOnce(emptyCatalog());
    await client.listMetrics({});
    vi.setSystemTime(Date.now() + 200);
    await expect(client.listMetrics({})).rejects.toMatchObject({
      errorCode: "dbt_semantic_timeout",
      details: { requestDispatched: false },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("cancels an in-flight create without retrying or reporting that no query was started", async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementationOnce(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new Error(options.token)),
            { once: true },
          );
          controller.abort(options.token);
        }),
    );
    const promise = createDbtSemanticClient({
      ...options,
      signal: controller.signal,
    }).startQuery({ metrics: [{ name: "orders" }] });
    await expect(promise).rejects.toMatchObject({
      errorCode: "dbt_semantic_cancelled",
      details: { requestDispatched: true, queryOutcome: "unknown" },
    });
    await expect(promise).rejects.not.toThrow(options.token);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("cancels the response stream while decoding and preserves cancellation as the failure", async () => {
    const controller = new AbortController();
    let cancelled = 0;
    const stream = new ReadableStream(
      {
        pull() {
          controller.abort(options.token);
        },
        cancel() {
          cancelled++;
        },
      },
      { highWaterMark: 0 },
    );
    mocks.fetch.mockResolvedValueOnce(new Response(stream));
    await expect(
      createDbtSemanticClient({
        ...options,
        signal: controller.signal,
      }).listMetrics({}),
    ).rejects.toMatchObject({
      errorCode: "dbt_semantic_cancelled",
      details: { requestDispatched: true },
    });
    expect(cancelled).toBe(1);
  });
  it("classifies a lost create response as uncertain and never repeats createQuery", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error(options.token));
    await expect(
      createDbtSemanticClient(options).startQuery({
        metrics: [{ name: "orders" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "dbt_semantic_unavailable",
      details: { requestDispatched: true, queryOutcome: "unknown" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("classifies a malformed create acknowledgement as uncertain", async () => {
    mocks.fetch.mockResolvedValueOnce(result({ createQuery: {} }));
    await expect(
      createDbtSemanticClient(options).startQuery({
        metrics: [{ name: "orders" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "dbt_semantic_response_invalid",
      details: { queryOutcome: "unknown" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch an invalid selection and gives a safe typed input error", async () => {
    await expect(
      createDbtSemanticClient(options).startQuery({ metrics: [] }),
    ).rejects.toMatchObject({
      errorCode: "dbt_semantic_input_invalid",
      details: { requestDispatched: false, queryOutcome: "not-dispatched" },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

it("ends a stalled response body at the caller deadline", async () => {
  let cancelled = 0;
  const body = new ReadableStream(
    {
      pull() {},
      cancel() {
        cancelled++;
      },
    },
    { highWaterMark: 0 },
  );
  mocks.fetch.mockResolvedValueOnce(new Response(body));
  await expect(
    createDbtSemanticClient({
      ...options,
      deadline: Date.now() + 30,
    }).listMetrics({}),
  ).rejects.toMatchObject({
    errorCode: "dbt_semantic_timeout",
    details: { requestDispatched: true },
  });
  expect(cancelled).toBe(1);
});

it("does not let an error-response cancel promise hide a provider refusal", async () => {
  const body = new ReadableStream({
    cancel() {
      return new Promise(() => {});
    },
  });
  mocks.fetch.mockResolvedValueOnce(new Response(body, { status: 403 }));
  const attempt = createDbtSemanticClient({
    ...options,
    deadline: Date.now() + 10,
  })
    .listMetrics({})
    .then(
      () => "unexpected-success",
      (error) => error.errorCode,
    );
  const verdict = await Promise.race([
    attempt,
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
  ]);
  expect(verdict).toBe("dbt_semantic_access_denied");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("settles cancellation during SSRF preflight and cleans a response that arrives later", async () => {
  const controller = new AbortController();
  let cancelled = 0;
  let finish: (response: Response) => void = () => {};
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
        markStarted();
      }),
  );
  const attempt = createDbtSemanticClient({
    ...options,
    signal: controller.signal,
  })
    .listMetrics({})
    .then(
      () => "unexpected-success",
      (error) => error.errorCode,
    );
  await started;
  controller.abort(options.token);
  const verdict = await Promise.race([
    attempt,
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
  ]);
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(verdict).toBe("dbt_semantic_cancelled");
  expect(cancelled).toBe(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

function queryPage(overrides: Record<string, unknown>) {
  return result({
    query: {
      status: "COMPILED",
      error: null,
      totalPages: null,
      sql: null,
      jsonResult: null,
      ...overrides,
    },
  });
}

it("reports a compiled query as an in-progress page", async () => {
  mocks.fetch.mockResolvedValueOnce(queryPage({ sql: "select 1" }));
  await expect(
    createDbtSemanticClient(options).readQueryPage({
      queryId: "query-1",
      pageNum: 1,
    }),
  ).resolves.toEqual({ queryId: "query-1", status: "COMPILED", pageNum: 1 });
});

it("keeps a failed query after compilation a typed provider failure", async () => {
  mocks.fetch.mockResolvedValueOnce(
    queryPage({ status: "FAILED", error: options.token }),
  );
  const attempt = createDbtSemanticClient(options).readQueryPage({
    queryId: "query-1",
    pageNum: 1,
  });
  await expect(attempt).rejects.toMatchObject({
    errorCode: "dbt_semantic_query_failed",
    statusCode: 502,
  });
  await expect(attempt).rejects.not.toThrow(options.token);
});

it("rejects an unknown query status as an invalid response", async () => {
  mocks.fetch.mockResolvedValueOnce(queryPage({ status: "CANCELLED" }));
  await expect(
    createDbtSemanticClient(options).readQueryPage({
      queryId: "query-1",
      pageNum: 1,
    }),
  ).rejects.toMatchObject({ errorCode: "dbt_semantic_response_invalid" });
});

it("ends a query that stays compiled at the caller deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const client = createDbtSemanticClient({
    ...options,
    deadline: Date.now() + 100,
  });
  mocks.fetch.mockResolvedValueOnce(queryPage({}));
  await expect(
    client.readQueryPage({ queryId: "query-1", pageNum: 1 }),
  ).resolves.toMatchObject({ status: "COMPILED" });
  vi.setSystemTime(Date.now() + 200);
  await expect(
    client.readQueryPage({ queryId: "query-1", pageNum: 1 }),
  ).rejects.toMatchObject({
    errorCode: "dbt_semantic_timeout",
    details: { requestDispatched: false },
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

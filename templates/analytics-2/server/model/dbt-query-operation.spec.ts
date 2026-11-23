import { beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
}));
vi.mock("./dbt-query-operation-store.js", () => ({
  mutateDbtQueryOperation: async (
    scope: { ownerEmail: string; orgId: string },
    key: string,
    update: (raw: Record<string, unknown> | null) => Record<string, unknown>,
  ) => {
    const id = JSON.stringify([scope.ownerEmail, scope.orgId, key]);
    const next = update(structuredClone(storage.rows.get(id) ?? null));
    storage.rows.set(id, structuredClone(next));
    return structuredClone(next);
  },
}));
import {
  coordinateDbtQuery,
  type DbtQueryBinding,
} from "./dbt-query-operation.js";
const binding = (): DbtQueryBinding => ({
  ownerEmail: "qa@example.invalid",
  orgId: "qa-org",
  projectId: "qa-project",
  cellId: "qa-cell",
  connectionId: "qa-connection",
  revision: "qa-revision",
  selection: { metrics: [{ name: "orders" }] },
});
let current: DbtQueryBinding;
const client = { startQuery: vi.fn(), readQueryPage: vi.fn() };
const authorize = vi.fn(async () => ({ binding: current, client }));
const page = (n = 1, total = 2) => ({
  queryId: "provider-query",
  status: "SUCCESSFUL" as const,
  pageNum: n,
  totalPages: total,
  sql: "select order_count",
  fields: [{ name: "orders", type: "INTEGER" }],
  rows: [{ orders: n }],
});
const failure = (errorCode: string, details?: Record<string, unknown>) =>
  Object.assign(new Error("safe failure"), { errorCode, details });
const read = (operationId: string, pageNum = 1) =>
  coordinateDbtQuery({ mode: "read", operationId, pageNum }, authorize);
const start = () => coordinateDbtQuery({ mode: "start" }, authorize);
beforeEach(() => {
  storage.rows.clear();
  vi.resetAllMocks();
  current = binding();
  authorize.mockImplementation(async () => ({ binding: current, client }));
  client.startQuery.mockResolvedValue({ queryId: "provider-query" });
  client.readQueryPage.mockResolvedValue(page());
});
it("marks an expired operation with an expired reason without changing the conflict code", async () => {
  const created = await start();
  for (const value of storage.rows.values()) value.expiresAt = 0;
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
    details: { reason: "expired" },
  });
  expect(client.readQueryPage).not.toHaveBeenCalled();
});

it("keeps the provider error when the reservation was lost before failure persistence", async () => {
  const created = await start();
  client.readQueryPage.mockImplementationOnce(async () => {
    for (const value of storage.rows.values())
      value.reservation = "other-writer";
    throw failure("dbt_semantic_timeout");
  });
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_semantic_timeout",
  });
});

it("persists local provenance, returns complete paged results without leaking remote authority", async () => {
  const created = await start();
  expect(created.status).toBe("running");
  expect(JSON.stringify(created)).not.toContain("provider-query");
  const first = await read(created.operationId);
  expect(first.page?.rows).toEqual([{ orders: 1 }]);
  expect(first.sourceConnectionId).toBe("qa-connection");
  client.readQueryPage.mockResolvedValueOnce(page(2));
  const second = await read(created.operationId, 2);
  expect(second).toMatchObject({
    status: "complete",
    hasNextPage: false,
    nextPage: 3,
  });
  expect(client.readQueryPage.mock.calls.map(([v]) => v)).toEqual([
    { queryId: "provider-query", pageNum: 1 },
    { queryId: "provider-query", pageNum: 2 },
  ]);
  await expect(read(created.operationId, 3)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  expect(client.startQuery).toHaveBeenCalledTimes(1);
});
it("replays a committed page after a lost response/reload, with fresh authorization and no extra GET", async () => {
  const created = await start();
  const first = await read(created.operationId);
  const calls = authorize.mock.calls.length;
  expect(await read(created.operationId)).toEqual(first);
  expect(authorize.mock.calls.length).toBeGreaterThan(calls);
  client.readQueryPage.mockResolvedValueOnce(page(2));
  const final = await read(created.operationId, 2);
  expect(await read(created.operationId, 2)).toEqual(final);
  expect(client.readQueryPage).toHaveBeenCalledTimes(2);
});
it("read timeout preserves exact query/page for explicit Retry", async () => {
  const created = await start();
  client.readQueryPage.mockRejectedValueOnce(failure("dbt_semantic_timeout"));
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_semantic_timeout",
  });
  expect((await read(created.operationId)).page?.pageNum).toBe(1);
  expect(client.readQueryPage.mock.calls[0]).toEqual(
    client.readQueryPage.mock.calls[1],
  );
  expect(client.startQuery).toHaveBeenCalledTimes(1);
});
it.each(["unknown", undefined])(
  "uncertain create (%s) is never resubmitted",
  async (outcome) => {
    client.startQuery.mockRejectedValueOnce(
      failure(
        "dbt_semantic_timeout",
        outcome ? { queryOutcome: outcome } : undefined,
      ),
    );
    await expect(start()).rejects.toMatchObject({
      errorCode: "dbt_semantic_timeout",
    });
    expect([...storage.rows.values()][0]?.status).toBe("unknown");
    await expect(start()).rejects.toMatchObject({
      errorCode: "dbt_query_operation_changed",
    });
    expect(client.startQuery).toHaveBeenCalledTimes(1);
  },
);
it("proven not-dispatched create permits a later explicit new start", async () => {
  client.startQuery.mockRejectedValueOnce(
    failure("dbt_semantic_configuration_invalid", {
      queryOutcome: "not-dispatched",
    }),
  );
  await expect(start()).rejects.toMatchObject({
    errorCode: "dbt_semantic_configuration_invalid",
  });
  expect([...storage.rows.values()][0]?.status).toBe("failed");
  await expect(start()).resolves.toMatchObject({ status: "running" });
});
it("concurrent start cannot duplicate provider POST", async () => {
  let finish!: (value: { queryId: string }) => void;
  const entered = new Promise<void>((resolve) =>
    client.startQuery.mockImplementationOnce(() => {
      resolve();
      return new Promise((value) => {
        finish = value;
      });
    }),
  );
  const pending = start();
  await entered;
  await expect(start()).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  finish({ queryId: "provider-query" });
  await pending;
  expect(client.startQuery).toHaveBeenCalledTimes(1);
});
it("concurrent read cannot append the same page twice", async () => {
  const created = await start();
  let finish!: (value: ReturnType<typeof page>) => void;
  const entered = new Promise<void>((resolve) =>
    client.readQueryPage.mockImplementationOnce(() => {
      resolve();
      return new Promise((value) => {
        finish = value;
      });
    }),
  );
  const pending = read(created.operationId);
  await entered;
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  finish(page());
  await pending;
  expect(client.readQueryPage).toHaveBeenCalledTimes(1);
});
it.each([
  "ownerEmail",
  "orgId",
  "projectId",
  "cellId",
  "connectionId",
  "revision",
] as const)("refuses continuation after %s changes", async (field) => {
  const created = await start();
  current = { ...current, [field]: "different" };
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  expect(client.readQueryPage).not.toHaveBeenCalled();
});
it("refuses a changed saved selection", async () => {
  const created = await start();
  current = { ...current, selection: { metrics: [{ name: "revenue" }] } };
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  expect(client.readQueryPage).not.toHaveBeenCalled();
});
it("reauthorizes after provider completion and never publishes stale output", async () => {
  const created = await start();
  client.readQueryPage.mockImplementationOnce(async () => {
    current = { ...current, revision: "rotated" };
    return page();
  });
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  expect([...storage.rows.values()][0]?.nextPage).toBe(1);
});
it.each([
  "dbt_semantic_access_denied",
  "dbt_semantic_query_failed",
  "dbt_semantic_response_invalid",
])("does not retry terminal read %s", async (code) => {
  const created = await start();
  client.readQueryPage.mockRejectedValueOnce(failure(code));
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: code,
  });
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  expect(client.readQueryPage).toHaveBeenCalledTimes(1);
});
it.each(["schema", "pages", "query", "page"])(
  "rejects result %s drift without committing progress",
  async (drift) => {
    const created = await start();
    await read(created.operationId);
    const next = page(2);
    if (drift === "schema") next.fields[0]!.type = "STRING";
    if (drift === "pages") next.totalPages = 3;
    if (drift === "query") next.queryId = "foreign-query";
    if (drift === "page") next.pageNum = 1;
    client.readQueryPage.mockResolvedValueOnce(next);
    await expect(read(created.operationId, 2)).rejects.toMatchObject({
      errorCode: "dbt_query_operation_changed",
    });
    expect([...storage.rows.values()][0]?.nextPage).toBe(2);
  },
);
it("rejects raw provider id and expired operation before transport", async () => {
  const created = await start();
  await expect(read("provider-query")).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  for (const value of storage.rows.values()) value.expiresAt = 0;
  await expect(read(created.operationId)).rejects.toMatchObject({
    errorCode: "dbt_query_operation_changed",
  });
  expect(client.readQueryPage).not.toHaveBeenCalled();
});

import { MAX_CONCURRENT_SQL_QUERIES } from "@shared/sql-query-limits";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  recordQueryCost: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));
vi.mock("./cost-tracker", () => ({
  recordQueryCost: mocks.recordQueryCost,
}));

import { executeSqlQuery } from "./sql-query";

const SECRET_SQL = "SELECT secret_column FROM private_table";

describe("executeSqlQuery metadata, cost and timing", () => {
  let info: MockInstance<typeof console.info>;

  const timingLogs = () =>
    info.mock.calls
      .filter((args) => args[0] === "[sql-query] timing")
      .map((args) => args[1] as Record<string, unknown>);

  beforeEach(() => {
    mocks.callAction.mockReset();
    mocks.recordQueryCost.mockReset();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the cache and freshness metadata and nothing it was not given", async () => {
    mocks.callAction.mockResolvedValue({
      rows: [{ n: 1 }],
      schema: [{ name: "n", type: "INTEGER" }],
      cached: true,
      providerCacheHit: false,
      truncated: false,
      fetchedAt: "2026-10-14T12:00:00.000Z",
      bytesProcessed: 99,
      totalRows: 1,
    });

    await expect(executeSqlQuery("SELECT 1", "bigquery")).resolves.toEqual({
      rows: [{ n: 1 }],
      schema: [{ name: "n", type: "INTEGER" }],
      cached: true,
      providerCacheHit: false,
      truncated: false,
      fetchedAt: "2026-10-14T12:00:00.000Z",
    });

    mocks.callAction.mockResolvedValue({ rows: [], schema: [] });
    const bare = await executeSqlQuery("SELECT 1", "ga4");
    expect(Object.keys(bare).sort()).toEqual(["rows", "schema"]);
  });

  it("drops an unreadable fetch time with a warning instead of guessing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.callAction.mockResolvedValue({
      rows: [],
      schema: [],
      fetchedAt: "yesterday-ish",
    });

    const result = await executeSqlQuery("SELECT 1", "bigquery");

    expect(result).not.toHaveProperty("fetchedAt");
    expect(warn).toHaveBeenCalledWith(
      "[sql-query] ignored an unreadable fetchedAt",
    );
  });

  it("hands the cache flags and bytes to the cost counter once per response", async () => {
    mocks.callAction.mockResolvedValue({
      rows: [],
      schema: [],
      cached: true,
      providerCacheHit: true,
      bytesProcessed: 4096,
    });

    await executeSqlQuery("SELECT 1", "bigquery");

    expect(mocks.recordQueryCost).toHaveBeenCalledTimes(1);
    expect(mocks.recordQueryCost).toHaveBeenCalledWith({
      status: "success",
      cached: true,
      providerCacheHit: true,
      bytesProcessed: 4096,
    });
  });

  it("records a failed BigQuery request as an unknown scan, not as zero", async () => {
    mocks.callAction.mockRejectedValue(new Error("server exploded"));

    await expect(executeSqlQuery("SELECT 1", "bigquery")).rejects.toThrow(
      "server exploded",
    );
    await expect(executeSqlQuery("SELECT 1", "first-party")).rejects.toThrow();
    await expect(executeSqlQuery("SELECT 1", "ga4")).rejects.toThrow();

    expect(mocks.recordQueryCost.mock.calls).toEqual([
      [{ status: "error" }],
      [{ status: "error" }],
    ]);
    expect(
      timingLogs().map((log: Record<string, unknown>) => log.status),
    ).toEqual(["error", "error", "error"]);
  });

  it("records a request cancelled in flight as a cancelled scan", async () => {
    const controller = new AbortController();
    mocks.callAction.mockImplementation(
      (_name, _args, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = executeSqlQuery("SELECT 1", "bigquery", controller.signal);
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.recordQueryCost).toHaveBeenCalledWith({ status: "cancelled" });
    expect(timingLogs()[0]).toMatchObject({ status: "cancelled" });
  });

  it("charges nothing for a query cancelled while it waited for a slot", async () => {
    const finish: Array<(value: unknown) => void> = [];
    mocks.callAction.mockImplementation(
      () => new Promise((resolve) => finish.push(resolve)),
    );
    const holders = Array.from({ length: MAX_CONCURRENT_SQL_QUERIES }, () =>
      executeSqlQuery("SELECT 0", "bigquery"),
    );
    await vi.waitFor(() =>
      expect(finish).toHaveLength(MAX_CONCURRENT_SQL_QUERIES),
    );

    const controller = new AbortController();
    const queued = executeSqlQuery(SECRET_SQL, "bigquery", controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.callAction).toHaveBeenCalledTimes(MAX_CONCURRENT_SQL_QUERIES);
    expect(mocks.recordQueryCost).not.toHaveBeenCalled();
    const [timing] = timingLogs();
    expect(timing).toMatchObject({ status: "cancelled", requestMs: 0 });
    expect(timing.queueMs).toBeGreaterThanOrEqual(0);

    for (const resolve of finish) resolve({ rows: [], schema: [] });
    await Promise.all(holders);
  });

  it("logs durations and outcome without the SQL, rows, account or credentials", async () => {
    mocks.callAction.mockResolvedValue({
      rows: [{ email: "someone@example.com" }],
      schema: [],
      cached: true,
    });

    await executeSqlQuery(SECRET_SQL, "bigquery", undefined, {
      forceRefresh: true,
    });

    const [timing] = timingLogs();
    expect(Object.keys(timing).sort()).toEqual([
      "cacheType",
      "forceRefresh",
      "queueMs",
      "requestMs",
      "source",
      "status",
      "totalMs",
    ]);
    expect(timing).toMatchObject({
      status: "success",
      source: "bigquery",
      cacheType: "app",
      forceRefresh: true,
    });
    for (const key of ["queueMs", "requestMs", "totalMs"]) {
      expect(Number.isInteger(timing[key])).toBe(true);
    }
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("secret_column");
    expect(logged).not.toContain("someone@example.com");
  });

  it.each([
    ["no metadata", {}, "unknown"],
    ["an app miss with no provider status", { cached: false }, "unknown"],
    [
      "a provider miss with no app status",
      { providerCacheHit: false },
      "unknown",
    ],
    [
      "both layers reported as misses",
      { cached: false, providerCacheHit: false },
      "none",
    ],
    ["an app hit", { cached: true }, "app"],
    ["a provider hit", { cached: false, providerCacheHit: true }, "provider"],
  ] as const)(
    "logs the cache type for %s as %s",
    async (_name, metadata, expected) => {
      mocks.callAction.mockResolvedValue({ rows: [], schema: [], ...metadata });

      await executeSqlQuery("SELECT 1", "bigquery");

      expect(timingLogs()[0]).toMatchObject({ cacheType: expected });
    },
  );

  it("does not count a refusal in the response body as a scan", async () => {
    mocks.callAction.mockResolvedValue({
      error: "missing_key",
      message: "Connect BigQuery",
    });

    await expect(executeSqlQuery("SELECT 1", "bigquery")).rejects.toThrow(
      "Connect BigQuery",
    );

    expect(mocks.recordQueryCost).not.toHaveBeenCalled();
    expect(timingLogs()[0]).toMatchObject({ status: "error" });
  });
});

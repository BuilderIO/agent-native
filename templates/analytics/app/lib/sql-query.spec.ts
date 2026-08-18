import { FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS } from "@shared/dashboard-report-timeouts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addBytesProcessed: vi.fn(),
  callAction: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

vi.mock("./cost-tracker", () => ({
  addBytesProcessed: mocks.addBytesProcessed,
}));

import {
  DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
  executeSqlQuery,
} from "./sql-query";

describe("executeSqlQuery", () => {
  beforeEach(() => {
    mocks.addBytesProcessed.mockReset();
    mocks.callAction.mockReset();
  });

  it("uses the dashboard panel action with the existing source/query payload", async () => {
    const controller = new AbortController();
    mocks.callAction.mockResolvedValue({
      rows: [{ date: "2026-07-21", signups: 4 }],
      schema: [
        { name: "date", type: "string" },
        { name: "signups", type: "number" },
      ],
      bytesProcessed: 128,
    });

    await expect(
      executeSqlQuery(
        "SELECT date, signups FROM analytics_events",
        "first-party",
        controller.signal,
      ),
    ).resolves.toEqual({
      rows: [{ date: "2026-07-21", signups: 4 }],
      schema: [
        { name: "date", type: "string" },
        { name: "signups", type: "number" },
      ],
    });

    expect(mocks.callAction).toHaveBeenCalledWith(
      "query-dashboard-panel",
      {
        query: "SELECT date, signups FROM analytics_events",
        source: "first-party",
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeoutMs: DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
      }),
    );
    expect(mocks.addBytesProcessed).toHaveBeenCalledWith(128);
  });

  it("surfaces an unsupported-backend panel instead of an empty row set", async () => {
    mocks.callAction.mockResolvedValue({
      error: "unsupported_by_backend",
      backend: "bigquery",
      construct: "date_trunc('month', ...)",
      message:
        "This panel can't run on your current data backend (BigQuery) because its SQL uses date_trunc('month', ...). Edit the panel's SQL, or switch the backend back to PostgreSQL.",
    });

    await expect(
      executeSqlQuery(
        "SELECT date_trunc('month', event_date) AS d FROM analytics_events",
        "first-party",
      ),
    ).rejects.toThrow(/date_trunc\('month', \.\.\.\)/);
  });

  it("gives report panel actions their own timeout above the query timeout", async () => {
    const controller = new AbortController();
    mocks.callAction.mockResolvedValue({ rows: [] });

    await executeSqlQuery("SELECT 1", "first-party", controller.signal, {
      reportScreenshot: true,
    });

    expect(FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS).toBeLessThan(
      DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "query-dashboard-panel",
      { query: "SELECT 1", source: "first-party" },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeoutMs: DASHBOARD_REPORT_ACTION_TIMEOUT_MS,
      }),
    );
  });

  it("includes queue time in the dashboard action deadline", async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<{ rows: Record<string, unknown>[] }>();
      mocks.callAction.mockImplementation(
        (
          _name: string,
          args: { query: string; source: string },
          options?: { signal?: AbortSignal },
        ) => {
          if (args.query === "first") return first.promise;
          return new Promise((_, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          });
        },
      );

      const firstQuery = executeSqlQuery("first", "first-party");
      await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(1));
      const secondQuery = executeSqlQuery("second", "first-party");

      await vi.advanceTimersByTimeAsync(100);
      first.resolve({ rows: [] });
      await firstQuery;
      await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(2));

      const secondRejection = expect(secondQuery).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(
        DASHBOARD_REPORT_ACTION_TIMEOUT_MS - 100,
      );
      await secondRejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes first-party panel queries without blocking external sources", async () => {
    const firstPartyFirst = deferred<{ rows: Record<string, unknown>[] }>();
    const firstPartySecond = deferred<{ rows: Record<string, unknown>[] }>();
    mocks.callAction.mockImplementation(
      (
        _name: string,
        args: { query: string; source: string },
      ): Promise<{ rows: Record<string, unknown>[] }> => {
        if (args.query === "first") return firstPartyFirst.promise;
        if (args.query === "second") return firstPartySecond.promise;
        return Promise.resolve({ rows: [{ source: args.source }] });
      },
    );

    const first = executeSqlQuery("first", "first-party");
    const second = executeSqlQuery("second", "first-party");
    const external = executeSqlQuery("external", "bigquery");

    await vi.waitFor(() => {
      expect(mocks.callAction).toHaveBeenCalledTimes(2);
    });
    expect(
      mocks.callAction.mock.calls.map(([, args]) => [args.query, args.source]),
    ).toEqual([
      ["first", "first-party"],
      ["external", "bigquery"],
    ]);

    firstPartyFirst.resolve({ rows: [{ query: "first" }] });
    await first;
    await vi.waitFor(() => {
      expect(mocks.callAction).toHaveBeenCalledTimes(3);
    });
    expect(mocks.callAction.mock.calls[2]?.[1]).toEqual({
      query: "second",
      source: "first-party",
    });

    firstPartySecond.resolve({ rows: [{ query: "second" }] });
    await expect(second).resolves.toEqual({
      rows: [{ query: "second" }],
      schema: undefined,
    });
    await expect(external).resolves.toEqual({
      rows: [{ source: "bigquery" }],
      schema: undefined,
    });
  });

  it("preserves four-way concurrency for external panel queries", async () => {
    const calls = Array.from({ length: 5 }, () =>
      deferred<{ rows: Record<string, unknown>[] }>(),
    );
    mocks.callAction.mockImplementation(
      (
        _name: string,
        args: { query: string },
      ): Promise<{ rows: Record<string, unknown>[] }> =>
        calls[Number(args.query)]!.promise,
    );

    const queries = calls.map((_, index) =>
      executeSqlQuery(String(index), "bigquery"),
    );

    await vi.waitFor(() => {
      expect(mocks.callAction).toHaveBeenCalledTimes(4);
    });
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);

    for (let index = 0; index < 4; index += 1) {
      calls[index]!.resolve({ rows: [{ index }] });
    }
    await vi.waitFor(() => {
      expect(mocks.callAction).toHaveBeenCalledTimes(5);
    });
    calls[4]!.resolve({ rows: [{ index: 4 }] });

    await expect(Promise.all(queries)).resolves.toHaveLength(5);
  });
});

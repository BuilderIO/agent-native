import { isAgentActionStopError } from "@agent-native/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { runQuery, track } = vi.hoisted(() => ({
  runQuery: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../server/lib/bigquery", () => ({
  runQuery: (sql: string, options?: { signal?: AbortSignal }) =>
    runQuery(sql, options),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track,
}));

const { default: bigquery } = await import("./bigquery");

describe("bigquery action error handling", () => {
  beforeEach(() => {
    runQuery.mockReset();
    track.mockReset();
  });

  it("returns a recoverable result (does NOT stop the turn) on a schema/SQL error", async () => {
    runQuery.mockRejectedValue(
      new Error(
        "BigQuery API error 400: Unrecognized name: event_time at [1:201]",
      ),
    );

    const result = (await bigquery.run({
      sql: "SELECT event_time FROM `p.dbt_analytics.product_signups`",
    })) as Record<string, unknown>;

    expect(result.error).toBe("bigquery_query_failed");
    expect(result.recoverable).toBe(true);
    expect(result.message).toBe("Unrecognized name: event_time at [1:201]");
    expect(String(result.hint)).toMatch(/search-bigquery-schema/);
    expect(result).not.toHaveProperty("stopped");
  });

  it("extracts the message from a JSON BigQuery error body", async () => {
    runQuery.mockRejectedValue(
      new Error(
        'BigQuery API error 400: {"error":{"message":"Unrecognized name: event_time at [1:201]"}}',
      ),
    );

    const result = (await bigquery.run({
      sql: "SELECT event_time FROM t",
    })) as Record<string, unknown>;

    expect(result.message).toBe("Unrecognized name: event_time at [1:201]");
    expect(result.recoverable).toBe(true);
  });

  it("treats a query timeout as a cost problem, not a schema problem", async () => {
    runQuery.mockRejectedValue(
      new Error("BigQuery query timed out after 60 seconds"),
    );

    const result = (await bigquery.run({
      sql: "SELECT * FROM `p.dbt_analytics.events`",
    })) as Record<string, unknown>;

    expect(result.error).toBe("bigquery_query_timeout");
    expect(result.recoverable).toBe(true);
    expect(String(result.hint)).not.toMatch(/search-bigquery-schema/);
    expect(String(result.hint)).toMatch(/LIMIT|narrow the date range/i);
  });

  it("still stops the turn (non-recoverable) when BigQuery is not configured", async () => {
    runQuery.mockRejectedValue(
      new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured"),
    );

    await expect(bigquery.run({ sql: "SELECT 1" })).rejects.toSatisfy(
      (err: unknown) => isAgentActionStopError(err),
    );
  });

  it("passes successful query results straight through", async () => {
    runQuery.mockResolvedValue({
      rows: [{ week: "2026-05-11", signups: 42 }],
      totalRows: 1,
      schema: [],
      bytesProcessed: 0,
    });

    const result = await bigquery.run({ sql: "SELECT 1" });

    expect(result).toEqual({
      rows: [{ week: "2026-05-11", signups: 42 }],
      totalRows: 1,
      schema: [],
      bytesProcessed: 0,
    });
  });

  it("tracks bounded query diagnostics without storing SQL literals", async () => {
    runQuery.mockResolvedValue({
      rows: [{ count: 1 }],
      totalRows: 1,
      schema: [{ name: "count", type: "INTEGER" }],
      bytesProcessed: 8192,
    });

    await bigquery.run({
      sql: "SELECT COUNT(*) FROM `project.dataset.users` WHERE email = 'person@example.com' AND id = 123",
    });
    await bigquery.run({
      sql: "SELECT COUNT(*) FROM `project.dataset.users` WHERE email = 'someone@example.com' AND id = 456",
    });

    const [eventName, properties] = track.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const secondProperties = track.mock.calls[1]?.[1] as Record<
      string,
      unknown
    >;
    expect(eventName).toBe("sql_run");
    expect(properties).toMatchObject({
      surface: "bigquery",
      query_status: "success",
      bytes_processed: 8192,
      cache_hit: false,
      row_count: 1,
      total_rows: 1,
    });
    expect(properties.query_fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(secondProperties.query_fingerprint).toBe(
      properties.query_fingerprint,
    );
    expect(properties.query_duration_ms).toEqual(expect.any(Number));
    expect(JSON.stringify(properties)).not.toContain("person@example.com");
    expect(JSON.stringify(properties)).not.toContain("SELECT COUNT");
  });

  it("records query error categories without recording provider messages", async () => {
    runQuery.mockRejectedValue(
      new Error("BigQuery API error 400: Unrecognized name: event_time"),
    );

    const result = (await bigquery.run({
      sql: "SELECT event_time FROM `project.dataset.events`",
    })) as Record<string, unknown>;

    expect(result.error).toBe("bigquery_query_failed");
    const [, properties] = track.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(properties).toMatchObject({
      query_status: "error",
      error_category: "schema_or_sql",
    });
    expect(properties).not.toHaveProperty("error_message");
    expect(JSON.stringify(properties)).not.toContain("event_time");
  });

  it("forwards the agent run signal and stops cleanly when the run is cancelled", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("BigQuery query aborted", "AbortError");
    controller.abort();
    runQuery.mockRejectedValue(aborted);

    await expect(
      bigquery.run(
        { sql: "SELECT 1" },
        { caller: "tool", signal: controller.signal },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      if (!isAgentActionStopError(err)) return false;
      expect(err.errorCode).toBe("run_cancelled");
      expect(err.message).toBe(
        "The BigQuery query was cancelled because the agent run ended before it could finish.",
      );
      expect(err.toolResult).toContain('"recoverable": false');
      return true;
    });

    expect(runQuery).toHaveBeenCalledWith("SELECT 1", {
      signal: controller.signal,
    });
  });
});

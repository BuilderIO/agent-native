import { isAgentActionStopError } from "@agent-native/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { runQuery, recoverFromSchemaMiss, BigQueryBackendError } = vi.hoisted(
  () => {
    class MockBigQueryBackendError extends Error {
      readonly providerDetail: string | null;

      constructor(providerDetail: string | null) {
        super("BigQuery job error: invalid_query");
        this.name = "BigQueryBackendError";
        this.providerDetail = providerDetail;
      }
    }

    return {
      runQuery: vi.fn(),
      recoverFromSchemaMiss: vi.fn(),
      BigQueryBackendError: MockBigQueryBackendError,
    };
  },
);

vi.mock("../server/lib/bigquery", () => ({
  runQuery,
  BigQueryBackendError,
}));

vi.mock("../server/lib/bigquery-schema-recovery", () => ({
  recoverFromSchemaMiss,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: vi.fn(),
}));

const { default: bigquery } = await import("./bigquery");

describe("bigquery action error handling", () => {
  beforeEach(() => {
    runQuery.mockReset();
    recoverFromSchemaMiss.mockReset();
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

  it("uses private provider detail for BigQuery schema recovery", async () => {
    const sql = "SELECT private_field FROM t";
    const providerDetail = "Unrecognized name: private_field at [1:8]";
    runQuery.mockRejectedValue(new BigQueryBackendError(providerDetail));
    recoverFromSchemaMiss.mockResolvedValue({
      columns: ["public_field:STRING"],
    });

    const result = (await bigquery.run({ sql })) as Record<string, unknown>;

    expect(recoverFromSchemaMiss).toHaveBeenCalledWith(
      sql,
      providerDetail,
      undefined,
    );
    expect(result.message).toBe(providerDetail);
    expect(result.columns).toEqual(["public_field:STRING"]);
    expect(result).not.toHaveProperty("providerDetail");
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

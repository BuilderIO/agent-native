import { isAgentActionStopError } from "@agent-native/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

const runQuery = vi.fn();

vi.mock("../server/lib/bigquery", () => ({
  runQuery: (sql: string) => runQuery(sql),
}));

// Imported after the mock is registered so the action picks up the stub.
const { default: bigquery } = await import("./bigquery");

describe("bigquery action error handling", () => {
  beforeEach(() => {
    runQuery.mockReset();
  });

  it("returns a recoverable result (does NOT stop the turn) on a schema/SQL error", async () => {
    runQuery.mockRejectedValue(
      new Error(
        "BigQuery API error 400: Unrecognized name: event_time at [1:201]",
      ),
    );

    // The model must get this back as a normal tool result it can react to,
    // not a thrown AgentActionStopError that ends the turn.
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

  it("still stops the turn (non-recoverable) when BigQuery is not configured", async () => {
    runQuery.mockRejectedValue(
      new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured"),
    );

    await expect(bigquery.run({ sql: "SELECT 1" })).rejects.toSatisfy(
      (err: unknown) => isAgentActionStopError(err),
    );
  });

  it("passes successful query results straight through", async () => {
    runQuery.mockResolvedValue([{ week: "2026-05-11", signups: 42 }]);

    const result = await bigquery.run({ sql: "SELECT 1" });

    expect(result).toEqual([{ week: "2026-05-11", signups: 42 }]);
  });
});

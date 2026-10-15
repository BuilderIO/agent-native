import { describe, expect, it } from "vitest";

import { queryRunTelemetry } from "./query-metrics";

describe("queryRunTelemetry", () => {
  it("records bounded success counts", () => {
    expect(
      queryRunTelemetry({
        rows: [{ count: 2 }],
        schema: [{ name: "count", type: "number" }],
      }),
    ).toEqual({
      query_status: "success",
      row_count: 1,
      column_count: 1,
    });
  });

  it("records query and transport failures without the error text", () => {
    expect(
      queryRunTelemetry({ rows: [], error: "private provider detail" }),
    ).toEqual({
      query_status: "error",
      row_count: 0,
      column_count: 0,
      error_category: "query_error",
    });
    expect(queryRunTelemetry(undefined, new Error("network detail"))).toEqual({
      query_status: "error",
      row_count: 0,
      column_count: 0,
      error_category: "query_error",
    });
  });
});

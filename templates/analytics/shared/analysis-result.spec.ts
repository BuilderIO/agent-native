import { describe, expect, it } from "vitest";

import { getSingleNumericAnalysisResult } from "./analysis-result";

describe("getSingleNumericAnalysisResult", () => {
  it("selects a finite single numeric cell, including zero", () => {
    expect(
      getSingleNumericAnalysisResult({
        rows: [{ active_users: 0 }],
        schema: [{ name: "active_users", type: "number" }],
      }),
    ).toEqual({ label: "active_users", value: 0 });
  });

  it("does not summarize a truncated numeric result", () => {
    expect(
      getSingleNumericAnalysisResult({
        rows: [{ active_users: 12 }],
        schema: [{ name: "active_users", type: "number" }],
        truncated: true,
      }),
    ).toBeNull();
  });

  it.each([
    { rows: [], schema: [{ name: "count", type: "number" }] },
    {
      rows: [{ count: 1 }, { count: 2 }],
      schema: [{ name: "count", type: "number" }],
    },
    {
      rows: [{ count: 1, total: 2 }],
      schema: [
        { name: "count", type: "number" },
        { name: "total", type: "number" },
      ],
    },
    {
      rows: [{ count: "1" }],
      schema: [{ name: "count", type: "string" }],
    },
    {
      rows: [{ count: Number.NaN }],
      schema: [{ name: "count", type: "number" }],
    },
  ])("does not summarize non-scalar or non-numeric results", (result) => {
    expect(getSingleNumericAnalysisResult(result)).toBeNull();
  });
});

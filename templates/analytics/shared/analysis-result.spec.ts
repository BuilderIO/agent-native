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

  it("summarizes a comparison only with explicit values and period context", () => {
    const result = {
      rows: [
        {
          metric: "activated users",
          current_value: 482,
          previous_value: 408,
          period: "Last 30 days",
        },
      ],
      schema: [
        { name: "metric", type: "string" },
        { name: "current_value", type: "number" },
        { name: "previous_value", type: "number" },
        { name: "period", type: "string" },
      ],
    };

    expect(getSingleNumericAnalysisResult(result)).toEqual({
      label: "activated users",
      value: 482,
      comparison: {
        changeRatio: (482 - 408) / 408,
        period: "Last 30 days",
        previousValue: 408,
      },
    });
    expect(
      getSingleNumericAnalysisResult({
        ...result,
        rows: [{ ...result.rows[0], period: "" }],
      }),
    ).toBeNull();
    expect(
      getSingleNumericAnalysisResult({
        ...result,
        rows: [{ ...result.rows[0], previous_value: 0 }],
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

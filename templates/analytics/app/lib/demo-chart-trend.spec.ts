import { describe, expect, it } from "vitest";

import { createDemoChartTrendRows } from "./demo-chart-trend";

function values(rows: Record<string, unknown>[], key: string): number[] {
  return rows.flatMap((row) => {
    const value = row[key];
    if (value === null || value === undefined || value === "") return [];
    const numeric = Number(value);
    return Number.isFinite(numeric) ? [numeric] : [];
  });
}

function normalizedRoughness(series: number[]): number {
  const minimum = Math.min(...series);
  const range = Math.max(...series) - minimum;
  if (series.length < 3 || range === 0) return 0;
  const normalized = series.map((value) => (value - minimum) / range);
  return (
    normalized.slice(1).reduce((total, value, index) => {
      const previousStep =
        index === 0
          ? value - normalized[index]
          : normalized[index] - normalized[index - 1];
      const step = value - normalized[index];
      return total + Math.abs(step - previousStep);
    }, 0) /
    (series.length - 1)
  );
}

describe("createDemoChartTrendRows", () => {
  const sourceRows = [
    { date: "2026-07-01", signups: 40, revenue: 800, label: "Mon" },
    { date: "2026-07-02", signups: 12, revenue: 300, label: "Tue" },
    { date: "2026-07-03", signups: 75, revenue: 1200, label: "Wed" },
    { date: "2026-07-04", signups: 28, revenue: 650, label: "Thu" },
    { date: "2026-07-05", signups: 62, revenue: 950, label: "Fri" },
    { date: "2026-07-06", signups: 20, revenue: 500, label: "Sat" },
    { date: "2026-07-07", signups: 55, revenue: 1050, label: "Sun" },
  ];

  it("preserves row shape and each series range while ending up and right", () => {
    const result = createDemoChartTrendRows(
      sourceRows,
      ["signups", "revenue"],
      "panel-a",
    );

    expect(result).toHaveLength(sourceRows.length);
    expect(result.map(({ date, label }) => ({ date, label }))).toEqual(
      sourceRows.map(({ date, label }) => ({ date, label })),
    );

    for (const key of ["signups", "revenue"]) {
      const original = values(sourceRows, key);
      const transformed = values(result, key);
      expect(Math.min(...transformed)).toBe(Math.min(...original));
      expect(Math.max(...transformed)).toBe(Math.max(...original));
      expect(transformed[transformed.length - 1]).toBeGreaterThan(
        transformed[0],
      );
      expect(
        transformed.some((value, index) =>
          index === 0 ? false : value < transformed[index - 1],
        ),
      ).toBe(true);
      expect(
        transformed.some((value, index) =>
          index === 0 ? false : value > transformed[index - 1],
        ),
      ).toBe(true);
    }
  });

  it("is deterministic for one seed and gives series and seeds unique shapes", () => {
    const first = createDemoChartTrendRows(
      sourceRows,
      ["signups", "revenue"],
      "panel-a",
    );
    const repeated = createDemoChartTrendRows(
      sourceRows,
      ["signups", "revenue"],
      "panel-a",
    );
    const anotherPanel = createDemoChartTrendRows(
      sourceRows,
      ["signups", "revenue"],
      "panel-b",
    );

    expect(repeated).toEqual(first);
    expect(values(first, "signups")).not.toEqual(values(first, "revenue"));
    expect(values(anotherPanel, "signups")).not.toEqual(
      values(first, "signups"),
    );
  });

  it("handles numeric strings and leaves gaps and non-series fields intact", () => {
    const rows = [
      { period: "Jan", count: "20", note: "keep" },
      { period: "Feb", count: null, note: "gap" },
      { period: "Mar", count: "5", note: "keep" },
      { period: "Apr", count: "40", note: "keep" },
      { period: "May", count: "12", note: "keep" },
      { period: "Jun", count: "30", note: "keep" },
    ];
    const result = createDemoChartTrendRows(rows, ["count"], "strings");

    expect(result[1].count).toBeNull();
    expect(result.map((row) => row.period)).toEqual(
      rows.map((row) => row.period),
    );
    expect(result.map((row) => row.note)).toEqual(rows.map((row) => row.note));
    expect(
      result
        .filter((row) => row.count !== null)
        .every((row) => typeof row.count === "string"),
    ).toBe(true);
    expect(Math.min(...values(result, "count"))).toBe(5);
    expect(Math.max(...values(result, "count"))).toBe(40);
  });

  it("safely leaves empty, single-point, flat, and nonnumeric series alone", () => {
    const single = [{ date: "today", value: 7 }];
    const flat = [
      { date: "Mon", value: 4 },
      { date: "Tue", value: 4 },
      { date: "Wed", value: 4 },
    ];
    const labels = [
      { date: "Mon", value: "unknown" },
      { date: "Tue", value: null },
    ];

    expect(createDemoChartTrendRows([], ["value"], "empty")).toEqual([]);
    expect(createDemoChartTrendRows(single, ["value"], "single")).toBe(single);
    expect(createDemoChartTrendRows(flat, ["value"], "flat")).toBe(flat);
    expect(createDemoChartTrendRows(labels, ["value"], "labels")).toBe(labels);
  });

  it("does not mutate the query rows", () => {
    const snapshot = structuredClone(sourceRows);
    const result = createDemoChartTrendRows(sourceRows, ["signups"], "panel");

    expect(sourceRows).toEqual(snapshot);
    expect(result).not.toBe(sourceRows);
    expect(result[0]).not.toBe(sourceRows[0]);
  });

  it("matches normalized source volatility while keeping both series upward", () => {
    const smoothValues = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const spikyValues = [0, 95, 8, 80, 18, 100, 30, 88, 45, 92, 70];
    const smooth = createDemoChartTrendRows(
      smoothValues.map((value, index) => ({ index, value })),
      ["value"],
      "same-panel",
    );
    const spiky = createDemoChartTrendRows(
      spikyValues.map((value, index) => ({ index, value })),
      ["value"],
      "same-panel",
    );
    const smoothTrend = values(smooth, "value");
    const spikyTrend = values(spiky, "value");

    expect(normalizedRoughness(spikyTrend)).toBeGreaterThan(
      normalizedRoughness(smoothTrend) * 3,
    );
    expect(smoothTrend[smoothTrend.length - 1]).toBeGreaterThan(smoothTrend[0]);
    expect(spikyTrend[spikyTrend.length - 1]).toBeGreaterThan(spikyTrend[0]);
    expect(Math.min(...smoothTrend)).toBe(0);
    expect(Math.max(...smoothTrend)).toBe(100);
    expect(Math.min(...spikyTrend)).toBe(0);
    expect(Math.max(...spikyTrend)).toBe(100);
  });
});

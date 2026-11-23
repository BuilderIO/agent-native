import { describe, expect, it } from "vitest";

import { shapeCompleteChartRows } from "./CompleteResultChart";

describe("shapeCompleteChartRows", () => {
  it("fills missing calendar days and absent series with zero", () => {
    const day1 = Date.UTC(2026, 7, 1);
    const day2 = Date.UTC(2026, 7, 2);
    const day3 = Date.UTC(2026, 7, 3);
    const { rows, points } = shapeCompleteChartRows({
      resultRows: [
        { x: "2026-08-01", series: "alpha", value: 10, selectionId: "s1" },
        { x: "2026-08-03", series: "beta", value: 5, selectionId: "s2" },
      ],
      timeUnit: "day",
      aggregation: "sum",
      grouped: true,
      seriesCount: 2,
      seriesIndices: new Map([
        ["alpha", 0],
        ["beta", 1],
      ]),
    });

    expect(rows).toEqual([[day1], [day2], [day3]]);
    expect(points).toEqual([
      { rowIndex: 0, seriesIndex: 0, value: 10, selectionId: "s1" },
      { rowIndex: 2, seriesIndex: 1, value: 5, selectionId: "s2" },
      { rowIndex: 1, seriesIndex: 0, value: 0 },
      { rowIndex: 1, seriesIndex: 1, value: 0 },
      { rowIndex: 0, seriesIndex: 1, value: 0 },
      { rowIndex: 2, seriesIndex: 0, value: 0 },
    ]);
  });

  it("fills missing calendar days for single-series daily charts", () => {
    const day1 = Date.UTC(2026, 7, 1);
    const day2 = Date.UTC(2026, 7, 2);
    const day3 = Date.UTC(2026, 7, 3);
    const { rows, points } = shapeCompleteChartRows({
      resultRows: [
        { x: "2026-08-01", series: null, value: 4, selectionId: "s1" },
        { x: "2026-08-03", series: null, value: 7, selectionId: "s2" },
      ],
      timeUnit: "day",
      aggregation: "count",
      grouped: false,
      seriesCount: 1,
      seriesIndices: new Map([[null, 0]]),
    });

    expect(rows).toEqual([[day1], [day2], [day3]]);
    expect(points).toEqual([
      { rowIndex: 0, seriesIndex: 0, value: 4, selectionId: "s1" },
      { rowIndex: 2, seriesIndex: 0, value: 7, selectionId: "s2" },
      { rowIndex: 1, seriesIndex: 0, value: 0 },
    ]);
  });
});

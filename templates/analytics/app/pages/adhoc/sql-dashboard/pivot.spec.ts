import { afterEach, describe, expect, it, vi } from "vitest";

import { pivotRows, timeRangeDays } from "./pivot";

describe("pivotRows", () => {
  afterEach(() => vi.useRealTimers());

  it("maps finite dashboard ranges to days", () => {
    expect(timeRangeDays("7d")).toBe(7);
    expect(timeRangeDays("14d")).toBe(14);
    expect(timeRangeDays("all")).toBeUndefined();
    expect(timeRangeDays("invalid")).toBeUndefined();
  });

  it("preserves numeric x and series dimensions", () => {
    const result = pivotRows(
      [
        { quarter: 1, year: 2025, count: 5 },
        { quarter: 1, year: 2026, count: 2 },
        { quarter: 2, year: 2025, count: 7 },
      ],
      { xKey: "quarter", seriesKey: "year", valueKey: "count" },
      { fillDateGaps: false },
    );

    expect(result.seriesKeys).toEqual(["2025", "2026"]);
    expect(result.rows).toEqual([
      { quarter: 1, "2025": 5, "2026": 2 },
      { quarter: 2, "2025": 7, "2026": 0 },
    ]);
  });

  it("fills missing series buckets with zeroes", () => {
    const result = pivotRows(
      [
        { date: "2026-06-16", template: "docs", count: 5 },
        { date: "2026-06-16", template: "plan", count: 2 },
        { date: "2026-06-17", template: "docs", count: 7 },
      ],
      { xKey: "date", seriesKey: "template", valueKey: "count" },
    );

    expect(result.seriesKeys).toEqual(["docs", "plan"]);
    expect(result.rows).toEqual([
      { date: "2026-06-16", docs: 5, plan: 2 },
      { date: "2026-06-17", docs: 7, plan: 0 },
    ]);
  });

  it("fills missing daily rows with zeroes for sparse date series", () => {
    const result = pivotRows(
      [
        { date: "2026-06-16", template: "content", count: 1 },
        { date: "2026-06-18", template: "content", count: 4 },
        { date: "2026-06-18", template: "unknown", count: 2 },
      ],
      { xKey: "date", seriesKey: "template", valueKey: "count" },
    );

    expect(result.seriesKeys).toEqual(["content", "unknown"]);
    expect(result.rows).toEqual([
      { date: "2026-06-16", content: 1, unknown: 0 },
      { date: "2026-06-17", content: 0, unknown: 0 },
      { date: "2026-06-18", content: 4, unknown: 2 },
    ]);
  });

  it("can preserve only returned date buckets for bar-chart auto sizing", () => {
    const result = pivotRows(
      [
        { date: "2026-06-16", template: "content", count: 5 },
        { date: "2026-06-18", template: "content", count: 8 },
        { date: "2026-06-18", template: "plan", count: 2 },
      ],
      { xKey: "date", seriesKey: "template", valueKey: "count" },
      { fillDateGaps: false },
    );

    expect(result.seriesKeys).toEqual(["content", "plan"]);
    expect(result.rows).toEqual([
      { date: "2026-06-16", content: 5, plan: 0 },
      { date: "2026-06-18", content: 8, plan: 2 },
    ]);
  });

  it("pads a finite date range through the current day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00Z"));

    const result = pivotRows(
      [
        { date: "2026-06-15", template: "content", count: 99 },
        { date: "2026-06-18", template: "content", count: 1 },
        { date: "2026-06-19", template: "content", count: 4 },
      ],
      { xKey: "date", seriesKey: "template", valueKey: "count" },
      { timeRange: 5 },
    );

    expect(result.rows).toEqual([
      { date: "2026-06-16", content: 0 },
      { date: "2026-06-17", content: 0 },
      { date: "2026-06-18", content: 1 },
      { date: "2026-06-19", content: 4 },
      { date: "2026-06-20", content: 0 },
    ]);
  });

  it("keeps empty input empty when there are no series to zero-fill", () => {
    const result = pivotRows(
      [],
      { xKey: "date", seriesKey: "template", valueKey: "count" },
      { timeRange: 7 },
    );

    expect(result).toEqual({ rows: [], seriesKeys: [] });
  });
});

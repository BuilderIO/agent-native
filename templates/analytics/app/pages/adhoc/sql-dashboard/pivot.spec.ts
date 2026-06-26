import { describe, expect, it } from "vitest";

import { pivotRows } from "./pivot";

describe("pivotRows", () => {
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
});

import { describe, expect, it } from "vitest";

import type {
  SqlPanel,
  TableColumnConfig,
} from "@/pages/adhoc/sql-dashboard/types";

import {
  buildTableClipboardText,
  formatCell,
  formatSeriesLabelForPanel,
  reorderColumnConfigs,
  sortTableRows,
} from "./SqlChart";

describe("SqlChart table helpers", () => {
  it("reorders visible columns and leaves hidden entries in their slots", () => {
    const configs: TableColumnConfig[] = [
      { key: "a" },
      { key: "secret", hidden: true },
      { key: "b" },
      { key: "c" },
    ];

    expect(
      reorderColumnConfigs(configs, ["a", "b", "c"], "c", "a").map((c) => [
        c.key,
        c.hidden ?? false,
      ]),
    ).toEqual([
      ["c", false],
      ["secret", true],
      ["a", false],
      ["b", false],
    ]);
  });

  it("returns the same list when the move is a no-op", () => {
    const configs: TableColumnConfig[] = [{ key: "a" }, { key: "b" }];
    expect(reorderColumnConfigs(configs, ["a", "b"], "a", "a")).toBe(configs);
  });

  it("formats numeric strings from SQL providers like numeric values", () => {
    expect(formatCell("1234", "number")).toBe("1,234");
    expect(formatCell("0.125", "percent")).toBe("12.50%");
    expect(formatCell("-2.5", "delta")).toBe("-2.5%");
  });

  it("puts the sign before the dollar sign for currency cells", () => {
    expect(formatCell(-7505, "currency")).toBe("-$7,505");
    expect(formatCell(111090, "currency")).toBe("$111,090");
  });

  it("sorts negative formatted currency strings numerically", () => {
    const rows = [{ r: "$9" }, { r: "-$7,505" }, { r: "$1,000" }];
    expect(sortTableRows(rows, [{ key: "r", direction: "asc" }])).toEqual([
      { r: "-$7,505" },
      { r: "$9" },
      { r: "$1,000" },
    ]);
  });

  it("sorts by multiple columns while treating numeric strings as numbers", () => {
    const rows = [
      { team: "B", value: "10" },
      { team: "A", value: "10" },
      { team: "A", value: "2" },
    ];

    expect(
      sortTableRows(rows, [
        { key: "team", direction: "asc" },
        { key: "value", direction: "desc" },
      ]),
    ).toEqual([
      { team: "A", value: "10" },
      { team: "A", value: "2" },
      { team: "B", value: "10" },
    ]);
  });

  it("sorts a revenue-style numeric column numerically, not lexicographically (10 vs 9)", () => {
    const rows = [{ revenue: "9" }, { revenue: "10" }, { revenue: "2" }];

    expect(sortTableRows(rows, [{ key: "revenue", direction: "asc" }])).toEqual(
      [{ revenue: "2" }, { revenue: "9" }, { revenue: "10" }],
    );
  });

  it("sorts negative numeric strings numerically", () => {
    const rows = [{ delta: "-5" }, { delta: "3" }, { delta: "-20" }];

    expect(sortTableRows(rows, [{ key: "delta", direction: "asc" }])).toEqual([
      { delta: "-20" },
      { delta: "-5" },
      { delta: "3" },
    ]);
  });

  it("sorts formatted currency/thousands/percent strings by their numeric value", () => {
    const rows = [
      { revenue: "$9" },
      { revenue: "$1,000" },
      { revenue: "$120" },
    ];

    expect(sortTableRows(rows, [{ key: "revenue", direction: "asc" }])).toEqual(
      [{ revenue: "$9" }, { revenue: "$120" }, { revenue: "$1,000" }],
    );

    const percents = [{ rate: "9%" }, { rate: "12.5%" }, { rate: "100%" }];
    expect(
      sortTableRows(percents, [{ key: "rate", direction: "asc" }]),
    ).toEqual([{ rate: "9%" }, { rate: "12.5%" }, { rate: "100%" }]);
  });

  it("sorts unparseable values after numeric ones in a mixed column, regardless of direction", () => {
    const rows = [
      { revenue: "10" },
      { revenue: "N/A" },
      { revenue: "2" },
      { revenue: "" },
    ];

    expect(sortTableRows(rows, [{ key: "revenue", direction: "asc" }])).toEqual(
      [
        { revenue: "2" },
        { revenue: "10" },
        { revenue: "" },
        { revenue: "N/A" },
      ],
    );
    expect(
      sortTableRows(rows, [{ key: "revenue", direction: "desc" }]),
    ).toEqual([
      { revenue: "10" },
      { revenue: "2" },
      { revenue: "N/A" },
      { revenue: "" },
    ]);
  });

  it("builds formatted tab-separated clipboard content", () => {
    const columns: TableColumnConfig[] = [
      { key: "name", label: "Name" },
      { key: "count", label: "Count", format: "number" },
    ];

    expect(
      buildTableClipboardText(columns, [{ name: "A\nteam", count: "1234" }]),
    ).toBe("Name\tCount\nA team\t1,234");
  });

  it("uses configured series aliases before provider-specific formatting", () => {
    const panel: SqlPanel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 1",
      source: "prometheus",
      chartType: "line",
      width: 1,
      config: { seriesLabels: { signup_total: "Signups" } },
    };

    expect(formatSeriesLabelForPanel(panel, "signup_total")).toBe("Signups");
  });
});

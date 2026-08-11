import { describe, expect, it } from "vitest";

import type {
  SqlPanel,
  TableColumnConfig,
} from "@/pages/adhoc/sql-dashboard/types";

import {
  buildTableClipboardText,
  formatCell,
  formatSeriesLabelForPanel,
  sortTableRows,
} from "./SqlChart";

describe("SqlChart table helpers", () => {
  it("formats numeric strings from SQL providers like numeric values", () => {
    expect(formatCell("1234", "number")).toBe("1,234");
    expect(formatCell("0.125", "percent")).toBe("12.50%");
    expect(formatCell("-2.5", "delta")).toBe("-2.5%");
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

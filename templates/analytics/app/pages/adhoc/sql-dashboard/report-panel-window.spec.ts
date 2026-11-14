import type { SqlPanel } from "@agent-native/toolkit/dashboard/sql-dashboard-types";
import { describe, expect, it } from "vitest";

import { listReportablePanelIds } from "./report-panel-window";

function panel(
  id: string,
  chartType: SqlPanel["chartType"] = "metric",
): SqlPanel {
  return {
    id,
    title: id,
    sql: "select 1",
    source: "demo",
    chartType,
    width: 1,
  };
}

describe("listReportablePanelIds", () => {
  it("reports chart panels in order and skips section headers", () => {
    const panels = [
      panel("overview", "section"),
      panel("a"),
      panel("b"),
      panel("details", "section"),
      panel("c"),
      panel("d"),
      panel("e"),
    ];

    expect(listReportablePanelIds(panels)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

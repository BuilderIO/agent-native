import { describe, expect, it } from "vitest";

import {
  countReportablePanels,
  listReportablePanelIds,
  parseReportPanelWindow,
  windowReportPanels,
} from "./report-panel-window";
import type { SqlPanel } from "./types";

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

describe("report panel windows", () => {
  const panels = [
    panel("overview", "section"),
    panel("a"),
    panel("b"),
    panel("details", "section"),
    panel("c"),
    panel("d"),
    panel("e"),
  ];

  it("uses non-section panels for offsets and repeats the applicable section", () => {
    expect(countReportablePanels(panels)).toBe(5);
    expect(listReportablePanelIds(panels)).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      windowReportPanels(panels, { offset: 2, limit: 2 }).map((p) => p.id),
    ).toEqual(["details", "c", "d"]);
  });

  it("covers every chart once across consecutive windows while keeping headings readable", () => {
    const windows = [0, 2, 4].map((offset) =>
      windowReportPanels(panels, { offset, limit: 2 }),
    );
    expect(
      windows
        .flat()
        .filter((p) => p.chartType !== "section")
        .map((p) => p.id),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(windows[1]?.map((p) => p.id)).toEqual(["details", "c", "d"]);
  });

  it("only enables the report window when both offset and limit are present", () => {
    expect(parseReportPanelWindow(null, "8")).toBeNull();
    expect(parseReportPanelWindow("0", null)).toBeNull();
    expect(parseReportPanelWindow("8", "8")).toEqual({ offset: 8, limit: 4 });
  });

  it("splits eight reportable panels into two concurrency-sized query waves", () => {
    const eightPanels = Array.from({ length: 8 }, (_, index) =>
      panel(`panel-${index}`),
    );

    expect(
      [0, 4].map((offset) =>
        windowReportPanels(eightPanels, { offset, limit: 4 }).map(
          (entry) => entry.id,
        ),
      ),
    ).toEqual([
      ["panel-0", "panel-1", "panel-2", "panel-3"],
      ["panel-4", "panel-5", "panel-6", "panel-7"],
    ]);
  });
});

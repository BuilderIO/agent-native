import { describe, expect, it } from "vitest";

import {
  buildDashboardPanelGroups,
  movePanelToDropSlot,
  removePanelFromLayout,
  type DashboardDropSlot,
} from "./dashboard-layout";
import type { SqlPanel } from "./types";

function panel(id: string, width = 1): SqlPanel {
  return {
    id,
    title: id,
    sql: "SELECT 1 AS value",
    source: "first-party",
    chartType: "metric",
    width,
  };
}

function ids(rows: Array<{ panels: SqlPanel[] }>): string[][] {
  return rows.map((row) => row.panels.map((item) => item.id));
}

describe("dashboard layout rows", () => {
  it("keeps later rows from backfilling when deleting from a row", () => {
    const panels = ["a", "b", "c", "d", "e"].map((id) => panel(id));

    const next = removePanelFromLayout(panels, "b", 3);
    const [group] = buildDashboardPanelGroups(next, 3);

    expect(ids(group.rows)).toEqual([
      ["a", "c"],
      ["d", "e"],
    ]);
    expect(next.map((item) => [item.id, item.width])).toEqual([
      ["a", 2],
      ["c", 1],
      ["d", 2],
      ["e", 1],
    ]);
  });

  it("removes a row when deleting its last panel", () => {
    const panels = [panel("a"), panel("b"), panel("c"), panel("d", 3)];

    const next = removePanelFromLayout(panels, "d", 3);
    const [group] = buildDashboardPanelGroups(next, 3);

    expect(ids(group.rows)).toEqual([["a", "b", "c"]]);
  });

  it("moves a panel into a new row drop slot", () => {
    const panels = ["a", "b", "c", "d", "e"].map((id) => panel(id));
    const slot: DashboardDropSlot = {
      type: "row",
      groupKey: "intro",
      rowIndex: 2,
    };

    const next = movePanelToDropSlot(panels, "b", slot, 3);
    const [group] = buildDashboardPanelGroups(next, 3);

    expect(ids(group.rows)).toEqual([["a", "c"], ["d", "e"], ["b"]]);
  });

  it("moves a panel into a column drop slot", () => {
    const panels = ["a", "b", "c", "d"].map((id) => panel(id));
    const slot: DashboardDropSlot = {
      type: "column",
      groupKey: "intro",
      rowIndex: 0,
      columnIndex: 1,
    };

    const next = movePanelToDropSlot(panels, "d", slot, 4);
    const [group] = buildDashboardPanelGroups(next, 4);

    expect(ids(group.rows)).toEqual([["a", "d", "b", "c"]]);
  });
});

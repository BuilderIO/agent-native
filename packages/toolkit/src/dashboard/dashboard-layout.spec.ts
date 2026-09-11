import { describe, expect, it } from "vitest";

import {
  buildDashboardPanelGroups,
  clampDashboardColumns,
  columnExpansionForDropSlot,
  movePanelToDropSlot,
  removePanelFromLayout,
  type DashboardLayoutPanel,
  type DashboardDropSlot,
} from "./dashboard-layout.js";

type Panel = DashboardLayoutPanel & { kind?: "section" | "chart" };

function panel(id: string, width = 1): Panel {
  return { id, width, kind: "chart" };
}

const options = { isSection: (item: Panel) => item.kind === "section" };

describe("dashboard layout", () => {
  it("groups a section and balances persisted widths per visible row", () => {
    const panels: Panel[] = [
      panel("a"),
      { id: "section", kind: "section", columns: 3 },
      panel("b"),
      panel("c"),
      panel("d"),
    ];
    const groups = buildDashboardPanelGroups(panels, 2, options);

    expect(
      groups.map((group) =>
        group.rows.map((row) => row.panels.map((item) => item.id)),
      ),
    ).toEqual([[["a"]], [["b", "c", "d"]]]);
    expect(groups[1].columns).toBe(3);
  });

  it("removes without backfilling a later row", () => {
    const next = removePanelFromLayout(
      ["a", "b", "c", "d", "e"].map((id) => panel(id)),
      "b",
      3,
      options,
    );
    expect(next.map((item) => [item.id, item.width])).toEqual([
      ["a", 2],
      ["c", 1],
      ["d", 2],
      ["e", 1],
    ]);
  });

  it("moves into a column slot and grows the target group as needed", () => {
    const panels = ["a", "b", "c"].map((id) => panel(id));
    const slot: DashboardDropSlot = {
      type: "column",
      groupKey: "intro",
      rowIndex: 0,
      columnIndex: 1,
    };
    const groups = buildDashboardPanelGroups(panels, 2, options);
    expect(columnExpansionForDropSlot(groups, "c", slot)).toEqual({
      columns: 3,
      sectionPanelId: null,
    });

    const next = movePanelToDropSlot(panels, "c", slot, 2, options);
    expect(next.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(next.map((item) => item.width)).toEqual([1, 1, 1]);
  });

  it("clamps malformed and out-of-range column counts", () => {
    expect(clampDashboardColumns("4")).toBe(2);
    expect(clampDashboardColumns(-3)).toBe(1);
    expect(clampDashboardColumns(99)).toBe(6);
  });
});

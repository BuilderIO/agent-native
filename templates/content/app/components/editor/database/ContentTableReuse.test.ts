import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// source-read-ok: a composition boundary: Collections must build on the shared table controls, which draw the same either way.
const databaseViewSource = readFileSync(
  new URL("./DatabaseView.tsx", import.meta.url),
  "utf8",
);
// source-read-ok: a composition boundary: Trash must build on the shared table surface rather than a copy of it.
const trashBrowserSource = readFileSync(
  new URL("../../trash/TrashBrowser.tsx", import.meta.url),
  "utf8",
);
// source-read-ok: a composition boundary: Trash's filters must build on the shared search and chip controls.
const trashFiltersSource = readFileSync(
  new URL("../../trash/TrashFilters.tsx", import.meta.url),
  "utf8",
);
// source-read-ok: a composition boundary: Trash's selection bar must be the shared one.
const trashRecoveryActionsSource = readFileSync(
  new URL("../../trash/TrashRecoveryActions.tsx", import.meta.url),
  "utf8",
);
// source-read-ok: a composition boundary: Trash rows must build on the shared selection and row-action controls.
const trashRowSource = readFileSync(
  new URL("../../trash/TrashRow.tsx", import.meta.url),
  "utf8",
);
// source-read-ok: a composition boundary, like the reads above: Discussion must build on the shared table controls.
const discussionPanelSource = readFileSync(
  new URL("../discussion-panel.tsx", import.meta.url),
  "utf8",
);

// oracle-change: the Trash preview URL test is now rendered in components/trash/TrashBrowser.preview.test.tsx
describe("Collection and Trash table composition", () => {
  it("routes both callers through the shared table surface", () => {
    expect(databaseViewSource).toContain("<ContentTableSurface");
    expect(trashBrowserSource).toContain("<ContentTableSurface");
    expect(trashBrowserSource).not.toContain("TrashTableSurface");
    expect(trashRowSource).not.toContain("function TrashTableSurface");
  });

  it("routes both callers through the shared search and constraint controls", () => {
    expect(databaseViewSource).toContain("<ContentTableToolbar");
    expect(databaseViewSource).toContain("<ContentTableSearch");
    expect(databaseViewSource).not.toContain("<ContentTableConstraintChip");
    expect(trashFiltersSource).toContain("<ContentTableToolbar");
    expect(trashFiltersSource).toContain("<ContentTableSearch");
    expect(trashFiltersSource).toContain("<ContentTableConstraintChip");
  });

  it("routes a Page's Discussion through the same search, toolbar, and chip controls", () => {
    for (const control of [
      "<ContentTableToolbar",
      "<ContentTableToolbarButton",
      "<ContentTableSearch",
      "<ContentTableConstraintBar",
      "<ContentTableConstraintChip",
    ]) {
      expect(discussionPanelSource).toContain(control);
    }
    expect(discussionPanelSource).toContain(
      'from "@/components/editor/database/ContentTable"',
    );
  });

  it("routes both callers through shared selection and row-action controls", () => {
    expect(databaseViewSource).toContain("<ContentTableSelectionControl");
    expect(databaseViewSource).toContain("<ContentTableSelectionBar");
    expect(databaseViewSource).toContain("<ContentTableRowActionButton");
    expect(trashRowSource).toContain("<ContentTableSelectionControl");
    expect(trashRecoveryActionsSource).toContain("<ContentTableSelectionBar");
    expect(trashRowSource).toContain("<ContentTableRowActionButton");
  });
});

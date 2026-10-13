import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const databaseViewSource = readFileSync(
  new URL("./DatabaseView.tsx", import.meta.url),
  "utf8",
);
const trashBrowserSource = readFileSync(
  new URL("../../trash/TrashBrowser.tsx", import.meta.url),
  "utf8",
);
const trashFiltersSource = readFileSync(
  new URL("../../trash/TrashFilters.tsx", import.meta.url),
  "utf8",
);
const trashRecoveryActionsSource = readFileSync(
  new URL("../../trash/TrashRecoveryActions.tsx", import.meta.url),
  "utf8",
);
const trashRowSource = readFileSync(
  new URL("../../trash/TrashRow.tsx", import.meta.url),
  "utf8",
);

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
    expect(databaseViewSource).toContain("<ContentTableConstraintChip");
    expect(trashFiltersSource).toContain("<ContentTableToolbar");
    expect(trashFiltersSource).toContain("<ContentTableSearch");
    expect(trashFiltersSource).toContain("<ContentTableConstraintChip");
  });

  it("routes both callers through shared selection and row-action controls", () => {
    expect(databaseViewSource).toContain("<ContentTableSelectionControl");
    expect(databaseViewSource).toContain("<ContentTableSelectionBar");
    expect(databaseViewSource).toContain("<ContentTableRowActionButton");
    expect(trashRowSource).toContain("<ContentTableSelectionControl");
    expect(trashRecoveryActionsSource).toContain("<ContentTableSelectionBar");
    expect(trashRowSource).toContain("<ContentTableRowActionButton");
  });

  it("keeps Trash preview state synchronized with its URL", () => {
    expect(trashRowSource).toContain("/trash?preview=");
    expect(trashBrowserSource).toContain('void navigate("/trash")');
  });
});

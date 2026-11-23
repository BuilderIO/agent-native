import { describe, expect, it } from "vitest";

import {
  CELL_CATEGORIES,
  CELL_CATEGORY_ORDER,
  addCellMenuEntries,
  addCellMenuKinds,
  cellKindDefinition,
  isCellKind,
  parameterInputMenuOrder,
  parameterInputName,
  shortcutToCellKind,
} from "./cell-types.js";

describe("cell kinds", () => {
  it("lists categories in menu order and covers every kind", () => {
    expect(CELL_CATEGORY_ORDER).toEqual([
      "logic",
      "text",
      "data",
      "transform",
      "visualization",
      "input",
    ]);
    expect(new Set(CELL_CATEGORY_ORDER)).toEqual(new Set(CELL_CATEGORIES));
  });

  it("builds the add-cell menu in the order the menu shows", () => {
    expect(addCellMenuEntries().map((entry) => entry.name)).toEqual([
      "Python",
      "SQL",
      "Component",
      "Section",
      "Text",
      "Markdown",
      "Metric",
      "Pivot",
      "Filter",
      "Chart",
      "Table",
      "Map",
      "Single value",
      "Button",
      "Checkbox",
      "Date",
      "Dropdown",
      "File upload",
      "Multiselect",
      "Number input",
      "Slider",
      "Table input",
      "Text input",
    ]);
  });

  it("offers every parameter type as its own Inputs entry", () => {
    const inputs = addCellMenuEntries().filter(
      (entry) => entry.category === "input",
    );
    expect(inputs).toHaveLength(10);
    expect(inputs.every((entry) => entry.kind === "input")).toBe(true);
    expect(inputs.map((entry) => entry.inputType)).toEqual(
      parameterInputMenuOrder(),
    );
    expect(addCellMenuKinds().filter((kind) => kind === "input")).toEqual([
      "input",
    ]);
  });

  it("never offers deprecated or disabled kinds", () => {
    const kinds = addCellMenuKinds();
    for (const kind of [
      "cell-group",
      "block",
      "vega-chart",
      "explore",
      "writeback",
    ] as const) {
      expect(kinds).not.toContain(kind);
      expect(cellKindDefinition(kind).creatable).toBe(false);
    }
    expect(
      addCellMenuEntries().some((entry) => entry.name === "Vega chart"),
    ).toBe(false);
  });

  it("maps each add-cell shortcut to one kind", () => {
    expect(shortcutToCellKind()).toEqual({
      w: "code",
      q: "sql",
      v: "pivot",
      e: "text",
      n: "markdown",
      r: "chart",
      t: "display-table",
      u: "metric",
    });
    const shortcuts = addCellMenuEntries()
      .map((entry) => entry.shortcut)
      .filter((shortcut): shortcut is string => shortcut !== undefined);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("guards unknown kind names", () => {
    expect(isCellKind("sql")).toBe(true);
    expect(isCellKind("SQL")).toBe(false);
    expect(isCellKind("")).toBe(false);
  });

  it("keeps the default heights the renderers use", () => {
    expect(cellKindDefinition("metric").defaultHeight).toBe(123);
    expect(cellKindDefinition("code").defaultHeight).toBe(450);
    expect(cellKindDefinition("chart").defaultHeight).toBe(540);
    expect(cellKindDefinition("explore").defaultHeight).toBe(650);
    expect(cellKindDefinition("markdown").defaultHeight).toBe(200);
    expect(cellKindDefinition("map").defaultHeight).toBeNull();
  });

  it("names input types with the first letter upper-cased", () => {
    expect(parameterInputMenuOrder().map(parameterInputName)).toEqual([
      "Button",
      "Checkbox",
      "Date",
      "Dropdown",
      "File upload",
      "Multiselect",
      "Number input",
      "Slider",
      "Table input",
      "Text input",
    ]);
  });
});

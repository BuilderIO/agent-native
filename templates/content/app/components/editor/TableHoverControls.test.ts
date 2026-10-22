// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { getCellAtAddress, getEditorTables } from "./TableHoverControls";

describe("getEditorTables", () => {
  it("leaves out tables in a reference preview's own editor", () => {
    const root = document.createElement("div");
    root.className = "ProseMirror";
    root.innerHTML = [
      '<div data-content-reference><div class="ProseMirror">',
      '<table id="referenced"><tr><td>Referenced</td></tr></table>',
      "</div></div>",
      '<table id="own"><tr><td>Own</td></tr></table>',
    ].join("");

    expect(getEditorTables(root).map((table) => table.id)).toEqual(["own"]);
  });
});

describe("getCellAtAddress", () => {
  it("counts a table's own rows and cells, not those of a preview in a cell", () => {
    const root = document.createElement("div");
    root.className = "ProseMirror";
    root.innerHTML = [
      "<table><tbody><tr><td>Item",
      '<div data-content-reference><div class="ProseMirror"><table><tbody>',
      "<tr><td>Nested</td><td>Nested</td></tr><tr><td>Nested</td></tr>",
      "</tbody></table></div></div>",
      "</td><td>State</td></tr>",
      "<tr><td>Alpha</td><td>Draft</td></tr></tbody></table>",
    ].join("");
    const tables = getEditorTables(root);
    const textAt = (rowIndex: number, columnIndex: number) =>
      getCellAtAddress(tables, { tableIndex: 0, rowIndex, columnIndex })
        ?.textContent;

    expect(textAt(0, 1)).toBe("State");
    expect(textAt(1, 0)).toBe("Alpha");
    expect(textAt(1, 1)).toBe("Draft");
  });
});

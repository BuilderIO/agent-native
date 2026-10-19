// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { getEditorTables } from "./TableHoverControls";

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

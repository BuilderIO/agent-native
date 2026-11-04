// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { startInPlaceTextSession } from "./in-place-text-session";
import { resolveSlidePointerTarget } from "./slide-pointer-target";
import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  parseClipboardGrid,
  pasteGridIntoTable,
  tableEditAvailability,
} from "./slide-table-editing";
import { findSmartBlock, isTextLeaf } from "./slide-text-targets";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountTable(html: string) {
  document.body.innerHTML = `<div class="slide-content"><div class="fmd-slide">${html}</div></div>`;
  const root = document.querySelector<HTMLElement>(".slide-content");
  const table = document.querySelector<HTMLTableElement>("table");
  if (!root || !table) throw new Error("no table mounted");
  return { root, table };
}

function cellAt(table: HTMLTableElement, row: number, column: number) {
  const cell = table.rows.item(row)?.cells.item(column);
  if (!cell) throw new Error(`no cell at ${row},${column}`);
  return cell;
}

const STYLED = `<table><tbody>
  <tr><td style="padding:4px" data-builder-id="a"><span style="color:red;font-weight:700">A1</span></td><td>B1</td></tr>
  <tr><td>A2</td><td>B2</td></tr>
</tbody></table>`;

describe("slide table editing", () => {
  it("types into a newly inserted row cell", () => {
    const { root, table } = mountTable(STYLED);
    expect(insertTableRow(cellAt(table, 0, 0), "below")).toBe(true);
    const cell = cellAt(table, 1, 0);
    expect(cell.outerHTML).toBe(
      '<td style="padding:4px"><span style="color:red;font-weight:700"><br></span></td>',
    );
    expect(isTextLeaf(cell)).toBe(true);
    expect(findSmartBlock(cell, root)).toBe(cell);

    const session = startInPlaceTextSession(cell);
    const span = cell.querySelector("span");
    if (!span) throw new Error("seeded cell lost its text style");
    const range = document.createRange();
    range.setStart(span, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    cell.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "N",
        bubbles: true,
        cancelable: true,
      }),
    );
    session.end();
    expect(cell.textContent).toBe("N");
    expect(cell.querySelector("span")?.getAttribute("style")).toBe(
      "color:red;font-weight:700",
    );
  });

  it("types into a newly inserted column cell", () => {
    const { root, table } = mountTable(STYLED);
    expect(insertTableColumn(cellAt(table, 0, 1), "right")).toBe(true);
    expect(table.rows[0]?.cells.length).toBe(3);
    const cell = cellAt(table, 1, 2);
    expect(cell.innerHTML).toBe("<br>");
    expect(findSmartBlock(cell, root)).toBe(cell);
  });

  it("treats a cell with no content at all as a text root", () => {
    const { root, table } = mountTable(
      "<table><tbody><tr><td></td><td>x</td></tr></tbody></table>",
    );
    const cell = cellAt(table, 0, 0);
    expect(isTextLeaf(cell)).toBe(true);
    expect(findSmartBlock(cell, root)).toBe(cell);
    expect(
      resolveSlidePointerTarget({
        root,
        point: { x: 0, y: 0 },
        target: cell,
        measure: { textRects: () => [] },
      }),
    ).toMatchObject({ kind: "object", textRoot: cell, hit: "text" });
  });

  it("adds and removes colgroup tracks, keeping the total width", () => {
    const { table } = mountTable(`<table style="table-layout:fixed">
      <colgroup><col style="width:25%"><col style="width:75%"></colgroup>
      <tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody>
    </table>`);
    const widths = () =>
      Array.from(table.querySelectorAll("col")).map((col) => col.style.width);

    expect(insertTableColumn(cellAt(table, 0, 0), "right")).toBe(true);
    expect(widths()).toEqual(["20%", "20%", "60%"]);
    expect(table.rows[1]?.cells.length).toBe(3);

    expect(deleteTableColumn(cellAt(table, 0, 2))).toBe(true);
    expect(widths()).toEqual(["50%", "50%"]);
    expect(table.rows[0]?.cells.length).toBe(2);
  });

  it("refuses column ops on tracks it cannot map, and says why", () => {
    const { table } = mountTable(`<table>
      <colgroup><col span="2"></colgroup>
      <tbody><tr><td>a</td><td>b</td></tr></tbody>
    </table>`);
    expect(tableEditAvailability(table)).toEqual({
      rows: null,
      columns: "column-layout",
    });
    expect(insertTableColumn(cellAt(table, 0, 0), "left")).toBe(false);
    expect(table.rows[0]?.cells.length).toBe(2);
  });

  it("reports merged cells for row and column ops instead of skipping them", () => {
    const { table } = mountTable(`<table><tbody>
      <tr><td colspan="2">a</td></tr><tr><td>b</td><td>c</td></tr>
    </tbody></table>`);
    expect(tableEditAvailability(table)).toEqual({
      rows: "merged-cells",
      columns: "merged-cells",
    });
    expect(insertTableRow(cellAt(table, 1, 0), "above")).toBe(false);
    expect(deleteTableRow(cellAt(table, 1, 0))).toBe(false);
    expect(table.rows.length).toBe(2);
  });
});

describe("pasting a grid into a table", () => {
  it("reads spreadsheet HTML and tab-separated text, but not plain lines", () => {
    expect(
      parseClipboardGrid(
        "<meta charset='utf-8'><table><tr><td>1</td><td colspan='2'>2</td></tr><tr><td>3</td><td>4</td><td>5</td></tr></table>",
        "",
      ),
    ).toEqual([
      ["1", "2", ""],
      ["3", "4", "5"],
    ]);
    expect(parseClipboardGrid("", "a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseClipboardGrid("", "one\ntwo")).toBeNull();
    expect(parseClipboardGrid("<table><tr><td>x</td></tr></table>", "x")).toBe(
      null,
    );
  });

  it("fills across and down from the cell, adding rows but never columns", () => {
    const { table } = mountTable(STYLED);
    expect(
      pasteGridIntoTable(cellAt(table, 1, 1), [
        ["p", "q", "dropped"],
        ["r", "s"],
      ]),
    ).toBe(true);
    expect(
      Array.from(table.rows).map((row) =>
        Array.from(row.cells).map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["A1", "B1"],
      ["A2", "p"],
      ["", "r"],
    ]);
    expect(cellAt(table, 2, 0).innerHTML).toBe("<br>");
  });

  it("keeps the target cell's own text style for pasted values", () => {
    const { table } = mountTable(STYLED);
    pasteGridIntoTable(cellAt(table, 0, 0), [["x", "y"]]);
    expect(cellAt(table, 0, 0).innerHTML).toBe(
      '<span style="color:red;font-weight:700">x</span>',
    );
  });

  it("lets the editor take a grid paste out of a cell's text session", () => {
    const { table } = mountTable(STYLED);
    const cell = cellAt(table, 0, 1);
    const pasted: DataTransfer[] = [];
    const session = startInPlaceTextSession(cell, {
      onPasteData: (data) => {
        pasted.push(data);
        return true;
      },
    });
    const text = cell.firstChild;
    if (!text) throw new Error("no cell text");
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "1\t2\n3\t4");
    cell.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
    session.end();
    expect(pasted).toHaveLength(1);
    expect(cell.textContent).toBe("B1");
  });
});

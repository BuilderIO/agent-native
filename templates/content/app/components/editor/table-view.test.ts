// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import { updateColumnsOnResize } from "@tiptap/pm/tables";
import { describe, expect, it, vi } from "vitest";

import {
  ContentTableView,
  fitTableColumns,
  READABLE_TABLE_COLUMN_MIN_WIDTH,
  READABLE_TABLE_MIN_WIDTH_PROPERTY,
  readableTableMinWidth,
} from "./table-view";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

function table(
  cells: Array<{ colspan?: number; colwidth?: number[] | null }>,
  attrs: Record<string, unknown> | null = null,
) {
  return schema.nodes.table.create(attrs, [
    schema.nodes.tableRow.create(
      null,
      cells.map((attrs) =>
        schema.nodes.tableCell.create(
          { colspan: 1, colwidth: null, ...attrs },
          schema.nodes.paragraph.create(),
        ),
      ),
    ),
  ]);
}

function minWidthOf(cells: Parameters<typeof table>[0]) {
  return readableTableMinWidth(new ContentTableView(table(cells), 25).colgroup);
}

function floorOf(view: ContentTableView) {
  return view.table.style.getPropertyValue(READABLE_TABLE_MIN_WIDTH_PROPERTY);
}

describe("readable table minimum width", () => {
  it("gives every unresized column a readable floor", () => {
    expect(minWidthOf([{}, {}, {}])).toBe(3 * READABLE_TABLE_COLUMN_MIN_WIDTH);
  });

  it("keeps resized columns at their chosen width", () => {
    expect(minWidthOf([{ colwidth: [200] }, {}, {}])).toBe(
      200 + 2 * READABLE_TABLE_COLUMN_MIN_WIDTH,
    );
  });

  it("counts each column a spanning cell covers", () => {
    expect(minWidthOf([{ colspan: 2 }, {}])).toBe(
      3 * READABLE_TABLE_COLUMN_MIN_WIDTH,
    );
    expect(minWidthOf([{ colspan: 2, colwidth: [120, 0] }])).toBe(
      120 + READABLE_TABLE_COLUMN_MIN_WIDTH,
    );
  });

  it("leaves fully resized tables to Tiptap's own width", () => {
    expect(minWidthOf([{ colwidth: [200] }, { colwidth: [80] }])).toBeNull();
  });
});

describe("ContentTableView", () => {
  it("is the node view the editor's tables use", () => {
    const tableExtension = createVisualEditorExtensions().find(
      (extension) => extension.name === "table",
    );

    expect(tableExtension?.options.View).toBe(ContentTableView);
  });

  it("applies the floor and clears it once every column is resized", () => {
    const view = new ContentTableView(table([{}, {}]), 25);

    expect(floorOf(view)).toBe(`${2 * READABLE_TABLE_COLUMN_MIN_WIDTH}px`);

    expect(view.update(table([{ colwidth: [150] }, { colwidth: [150] }]))).toBe(
      true,
    );
    expect(floorOf(view)).toBe("");
  });

  it("follows a column drag before the width reaches the document", async () => {
    const node = table([{ colwidth: [150] }, {}]);
    const view = new ContentTableView(node, 25);

    updateColumnsOnResize(node, view.colgroup, view.table, 25, 0, 400);

    await vi.waitFor(() =>
      expect(floorOf(view)).toBe(`${400 + READABLE_TABLE_COLUMN_MIN_WIDTH}px`),
    );
  });
});

describe("fit to width", () => {
  function colgroup(...widths: string[]) {
    const element = document.createElement("colgroup");
    for (const width of widths) {
      const col = document.createElement("col");
      col.style.width = width;
      element.append(col);
    }
    return element;
  }

  const widthsOf = (element: HTMLElement) =>
    Array.from(element.children, (col) => (col as HTMLElement).style.width);

  it("turns sized columns into shares, leaving unsized ones a readable floor", () => {
    const element = colgroup("200px", "", "100px");
    fitTableColumns(element);

    const total = 300 + READABLE_TABLE_COLUMN_MIN_WIDTH;
    expect(widthsOf(element)).toEqual([
      `${((200 / total) * 100).toFixed(3)}%`,
      "",
      `${((100 / total) * 100).toFixed(3)}%`,
    ]);
  });

  it("leaves columns no one has sized", () => {
    const element = colgroup("", "");
    fitTableColumns(element);

    expect(widthsOf(element)).toEqual(["", ""]);
  });

  it("drops the readable floor while the table fits the page", () => {
    const fitted = table([{}, { colwidth: [150] }], { fitPageWidth: true });
    const view = new ContentTableView(fitted, 25);

    expect(view.table.dataset.fitPageWidth).toBe("true");
    expect(floorOf(view)).toBe("");

    view.update(table([{}, { colwidth: [150] }], { fitPageWidth: false }));
    expect(view.table.dataset.fitPageWidth).toBeUndefined();
    expect(floorOf(view)).toBe(`${150 + READABLE_TABLE_COLUMN_MIN_WIDTH}px`);
  });
});

// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  ContentTableView,
  READABLE_TABLE_COLUMN_MIN_WIDTH,
  READABLE_TABLE_MIN_WIDTH_PROPERTY,
  readableTableMinWidth,
} from "./table-view";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

function table(cells: Array<{ colspan?: number; colwidth?: number[] | null }>) {
  return schema.nodes.table.create(null, [
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

describe("readable table minimum width", () => {
  it("gives every unresized column a readable floor", () => {
    expect(readableTableMinWidth(table([{}, {}, {}]))).toBe(
      3 * READABLE_TABLE_COLUMN_MIN_WIDTH,
    );
  });

  it("keeps resized columns at their chosen width", () => {
    expect(readableTableMinWidth(table([{ colwidth: [200] }, {}, {}]))).toBe(
      200 + 2 * READABLE_TABLE_COLUMN_MIN_WIDTH,
    );
  });

  it("counts each column a spanning cell covers", () => {
    expect(readableTableMinWidth(table([{ colspan: 2 }, {}]))).toBe(
      3 * READABLE_TABLE_COLUMN_MIN_WIDTH,
    );
    expect(
      readableTableMinWidth(table([{ colspan: 2, colwidth: [120, 0] }])),
    ).toBe(120 + READABLE_TABLE_COLUMN_MIN_WIDTH);
  });

  it("leaves fully resized tables to Tiptap's own width", () => {
    expect(
      readableTableMinWidth(table([{ colwidth: [200] }, { colwidth: [80] }])),
    ).toBeNull();
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

    expect(
      view.table.style.getPropertyValue(READABLE_TABLE_MIN_WIDTH_PROPERTY),
    ).toBe(`${2 * READABLE_TABLE_COLUMN_MIN_WIDTH}px`);

    expect(view.update(table([{ colwidth: [150] }, { colwidth: [150] }]))).toBe(
      true,
    );
    expect(
      view.table.style.getPropertyValue(READABLE_TABLE_MIN_WIDTH_PROPERTY),
    ).toBe("");
  });
});

// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";

import {
  deleteTableColumn,
  deleteTableColumns,
  deleteTableRow,
  deleteTableRows,
  findTableByIndex,
  getColumnColor,
  getRowColor,
  getTableHeaders,
  insertTableColumn,
  insertTableRow,
  setColumnColor,
  setColumnColors,
  setRowColor,
  setRowColors,
  setTableFitWidth,
  setTableHeaders,
  type TableAt,
  tableWithDuplicatedColumn,
} from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

// "h:Name" is a header cell, "Name" a plain one.
function cell(spec: string) {
  const header = spec.startsWith("h:");
  const text = header ? spec.slice(2) : spec;
  return (header ? schema.nodes.tableHeader : schema.nodes.tableCell).create(
    null,
    schema.nodes.paragraph.create(null, text ? schema.text(text) : null),
  );
}

function table(rows: string[][], attrs: Record<string, unknown> = {}) {
  return schema.nodes.table.create(
    attrs,
    rows.map((row) => schema.nodes.tableRow.create(null, row.map(cell))),
  );
}

function docWith(...tables: ProseMirrorNode[]) {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("Before")),
    ...tables,
  ]);
}

function edit(
  node: ProseMirrorNode,
  change: (tr: Transaction, table: TableAt) => void,
) {
  const tr = EditorState.create({ doc: docWith(node) }).tr;
  change(tr, findTableByIndex(tr.doc, 0)!);
  return findTableByIndex(tr.doc, 0)!.node;
}

function cells(node: ProseMirrorNode) {
  const rows: string[][] = [];
  node.forEach((row) => {
    const specs: string[] = [];
    row.forEach((child) =>
      specs.push(
        `${child.type.name === "tableHeader" ? "h:" : ""}${child.textContent}`,
      ),
    );
    rows.push(specs);
  });
  return rows;
}

const columnColors = (node: ProseMirrorNode) =>
  Array.from({ length: TableMap.get(node).width }, (_, index) =>
    getColumnColor(node, index),
  );

describe("findTableByIndex", () => {
  it("counts tables in document order", () => {
    const doc = docWith(table([["First"]]), table([["Second"]]));

    expect(findTableByIndex(doc, 1)?.node.textContent).toBe("Second");
    expect(findTableByIndex(doc, 1)?.pos).toBe(
      doc.child(0).nodeSize + doc.child(1).nodeSize,
    );
    expect(findTableByIndex(doc, 2)).toBeNull();
  });
});

describe("table headers", () => {
  it("reads the headers from the cells when the table's attributes don't match them", () => {
    expect(
      getTableHeaders(
        table([
          ["h:A", "h:B"],
          ["h:C", "D"],
        ]),
      ),
    ).toEqual({ row: true, column: true });
    expect(getTableHeaders(table([["A", "B"]], { headerRow: true }))).toEqual({
      row: false,
      column: false,
    });
  });

  it("turns on a header column and keeps the header row", () => {
    const next = edit(
      table([
        ["h:A", "h:B"],
        ["C", "D"],
      ]),
      (tr, target) => setTableHeaders(tr, target, { column: true }),
    );

    expect(cells(next)).toEqual([
      ["h:A", "h:B"],
      ["h:C", "D"],
    ]);
    expect(next.attrs).toMatchObject({ headerRow: true, headerColumn: true });
  });

  it("turns off the header row but keeps the header column's cells", () => {
    const next = edit(
      table([
        ["h:A", "h:B"],
        ["h:C", "D"],
      ]),
      (tr, target) => setTableHeaders(tr, target, { row: false }),
    );

    expect(cells(next)).toEqual([
      ["h:A", "B"],
      ["h:C", "D"],
    ]);
    expect(next.attrs).toMatchObject({ headerRow: false, headerColumn: true });
  });

  it.each<{ shape: string; rows: string[][]; covering: "row" | "column" }>([
    { shape: "one row", rows: [["A", "B"]], covering: "row" },
    { shape: "one column", rows: [["A"], ["B"]], covering: "column" },
    { shape: "one cell", rows: [["A"]], covering: "row" },
  ])(
    "tells a header row from a header column in a table of $shape",
    ({ rows, covering }) => {
      const other = covering === "row" ? "column" : "row";
      const one = edit(table(rows), (tr, target) =>
        setTableHeaders(tr, target, { [covering]: true }),
      );
      expect(getTableHeaders(one)).toEqual({
        [covering]: true,
        [other]: false,
      });

      const both = edit(one, (tr, target) =>
        setTableHeaders(tr, target, { [other]: true }),
      );
      expect(getTableHeaders(both)).toEqual({ row: true, column: true });

      const back = edit(both, (tr, target) =>
        setTableHeaders(tr, target, { [other]: false }),
      );
      expect(getTableHeaders(back)).toEqual({
        [covering]: true,
        [other]: false,
      });
      expect(cells(back)).toEqual(rows.map((row) => row.map((c) => `h:${c}`)));
    },
  );
});

describe("setTableFitWidth", () => {
  it("sets the table's fit-to-width attribute", () => {
    const next = edit(table([["A"]]), (tr, target) =>
      setTableFitWidth(tr, target, true),
    );

    expect(next.attrs.fitPageWidth).toBe(true);
  });
});

describe("row and column colours", () => {
  it("colours a row", () => {
    const next = edit(table([["A"], ["B"]]), (tr, target) =>
      setRowColor(tr, target, 1, "blue_bg"),
    );

    expect(getRowColor(next, 0)).toBeNull();
    expect(getRowColor(next, 1)).toBe("blue_bg");
  });

  it("colours a column the table's column list does not reach yet", () => {
    const next = edit(table([["A", "B", "C"]]), (tr, target) =>
      setColumnColor(tr, target, 2, "red"),
    );

    expect(columnColors(next)).toEqual([null, null, "red"]);
  });

  it("drops the column list once no column has a colour or width", () => {
    const next = edit(
      table([["A", "B"]], { colMeta: [{ color: "red" }] }),
      (tr, target) => setColumnColor(tr, target, 0, null),
    );

    expect(next.attrs.colMeta).toBeNull();
  });

  it("moves column colours with an inserted column", () => {
    const next = edit(
      table(
        [
          ["h:A", "h:B"],
          ["C", "D"],
        ],
        {
          colMeta: [{ color: "red" }, { color: "blue_bg" }],
        },
      ),
      (tr, target) => insertTableColumn(tr, target, 1),
    );

    expect(cells(next)).toEqual([
      ["h:A", "h:", "h:B"],
      ["C", "", "D"],
    ]);
    expect(columnColors(next)).toEqual(["red", null, "blue_bg"]);
  });

  it("inserts several columns in one edit", () => {
    const next = edit(
      table([
        ["h:A", "h:B"],
        ["C", "D"],
      ]),
      (tr, target) => {
        setRowColor(tr, target, 1, "red");
        insertTableColumn(tr, target, 2);
        insertTableColumn(tr, target, 3);
      },
    );

    expect(cells(next)).toEqual([
      ["h:A", "h:B", "h:", "h:"],
      ["C", "D", "", ""],
    ]);
    expect(getRowColor(next, 1)).toBe("red");
  });

  it("removes a deleted column's colour", () => {
    const next = edit(
      table([["A", "B"]], {
        colMeta: [{ color: "red" }, { color: "blue_bg" }],
      }),
      (tr, target) => deleteTableColumn(tr, target, 0),
    );

    expect(cells(next)).toEqual([["B"]]);
    expect(columnColors(next)).toEqual(["blue_bg"]);
  });

  it("gives a duplicated column its source's cells and colour", () => {
    const next = tableWithDuplicatedColumn(
      table([["A", "B"]], {
        colMeta: [{ color: "red" }, { color: "blue_bg" }],
      }),
      0,
    );

    expect(cells(next)).toEqual([["A", "A", "B"]]);
    expect(columnColors(next)).toEqual(["red", "red", "blue_bg"]);
  });
});

describe("rows", () => {
  it("inserts a plain row below the header row and deletes rows", () => {
    const inserted = edit(
      table([
        ["h:A", "h:B"],
        ["C", "D"],
      ]),
      (tr, target) => insertTableRow(tr, target, 1),
    );
    expect(cells(inserted)).toEqual([
      ["h:A", "h:B"],
      ["", ""],
      ["C", "D"],
    ]);

    const deleted = edit(inserted, (tr, target) =>
      deleteTableRow(tr, target, 2),
    );
    expect(cells(deleted)).toEqual([
      ["h:A", "h:B"],
      ["", ""],
    ]);
  });
});

describe("a merged cell's rows and columns", () => {
  // A table whose first cell spans `span` columns or rows.
  function withMergedCell(span: "colspan" | "rowspan", rows: string[][]) {
    const merged = schema.nodes.tableCell.create(
      { [span]: 2 },
      schema.nodes.paragraph.create(null, schema.text("A")),
    );
    const node = schema.nodes.table.create(
      null,
      rows.map((row, index) =>
        schema.nodes.tableRow.create(null, [
          ...(index === 0 ? [merged] : []),
          ...row.map(cell),
        ]),
      ),
    );
    const map = TableMap.get(node);
    return { node, span: map.findCell(map.map[0]) };
  }

  it("colours and deletes every column the cell covers", () => {
    const { node, span } = withMergedCell("colspan", [["C"], ["D", "E", "F"]]);

    const coloured = edit(node, (tr, target) =>
      setColumnColors(tr, target, span, "red"),
    );
    expect(columnColors(coloured)).toEqual(["red", "red", null]);

    const deleted = edit(coloured, (tr, target) =>
      deleteTableColumns(tr, target, span),
    );
    expect(cells(deleted)).toEqual([["C"], ["F"]]);
    expect(columnColors(deleted)).toEqual([null]);
  });

  it("duplicates a column by the grid, growing a cell merged across it", () => {
    const { node } = withMergedCell("colspan", [["C"], ["D", "E", "F"]]);
    const coloured = edit(node, (tr, target) =>
      setColumnColors(
        tr,
        target,
        { left: 1, right: 2, top: 0, bottom: 1 },
        "red",
      ),
    );

    // Column 1 is the merged cell's second column in the first row and E in
    // the second.
    const next = tableWithDuplicatedColumn(coloured, 1);
    expect(cells(next)).toEqual([
      ["A", "C"],
      ["D", "E", "E", "F"],
    ]);
    expect(next.firstChild!.firstChild!.attrs.colspan).toBe(3);
    expect(columnColors(next)).toEqual([null, "red", "red", null]);
    expect(TableMap.get(next).problems).toBeNull();
  });

  it("copies a cell merged down a column once, over the same rows", () => {
    const { node } = withMergedCell("rowspan", [["B"], ["C"], ["D", "E"]]);

    const next = tableWithDuplicatedColumn(node, 0);
    expect(cells(next)).toEqual([["A", "A", "B"], ["C"], ["D", "D", "E"]]);
    expect(next.firstChild!.child(1).attrs.rowspan).toBe(2);
    expect(TableMap.get(next).problems).toBeNull();
  });

  it("colours and deletes every row the cell covers", () => {
    const { node, span } = withMergedCell("rowspan", [
      ["B"],
      ["C"],
      ["D", "E"],
    ]);

    const coloured = edit(node, (tr, target) =>
      setRowColors(tr, target, span, "blue_bg"),
    );
    expect([0, 1, 2].map((row) => getRowColor(coloured, row))).toEqual([
      "blue_bg",
      "blue_bg",
      null,
    ]);

    const deleted = edit(coloured, (tr, target) =>
      deleteTableRows(tr, target, span),
    );
    expect(cells(deleted)).toEqual([["D", "E"]]);
  });
});

// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  deleteTableColumn,
  deleteTableColumns,
  deleteTableRow,
  deleteTableRows,
  findTableByIndex,
  finishTableMove,
  getColumnColor,
  getRowColor,
  getTableHeaders,
  insertTableColumn,
  insertTableRow,
  movedBlockStart,
  moveTableColumns,
  moveTableRows,
  putTableBlock,
  setColumnColor,
  setColumnColors,
  setRowColor,
  setRowColors,
  setTableColumnCount,
  setTableFitWidth,
  setTableHeaders,
  setTableRowCount,
  type TableAt,
  type TableAxis,
  tableGridSize,
  tableIndexAt,
  tableMoveBlock,
  tableMoveChangesOrder,
  tableMoveGaps,
  type TableSpan,
  tableWithDuplicatedColumn,
  takeTableBlock,
  type TakenTableBlock,
} from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

// "h:Name" is a header cell, "Name" a plain one.
function cell(spec: string) {
  const header = spec.startsWith("h:");
  const text = header ? spec.slice(2) : spec;
  return schema.node(
    header ? "tableHeader" : "tableCell",
    null,
    schema.node("paragraph", null, text ? schema.text(text) : undefined),
  );
}

function table(rows: string[][], attrs: Record<string, unknown> = {}) {
  return schema.node(
    "table",
    attrs,
    rows.map((row) => schema.node("tableRow", null, row.map(cell))),
  );
}

function docWith(...tables: ProseMirrorNode[]) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("Before")),
    ...tables,
  ]);
}

function firstTable(doc: ProseMirrorNode) {
  const table = findTableByIndex(doc, 0);
  if (!table) throw new Error("The document has no table");
  return table;
}

function edit(
  node: ProseMirrorNode,
  change: (tr: Transaction, table: TableAt) => void,
) {
  const tr = EditorState.create({ doc: docWith(node) }).tr;
  change(tr, firstTable(tr.doc));
  return firstTable(tr.doc).node;
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

function moveInTwoChanges(
  node: ProseMirrorNode,
  axis: TableAxis,
  block: TableSpan,
  gap: number,
) {
  let taken = null as TakenTableBlock | null;
  const between = edit(node, (tr, target) => {
    taken = takeTableBlock(tr, target, axis, block, gap);
  });
  const after = edit(between, (tr, target) => {
    if (!taken) throw new Error("Nothing was taken");
    putTableBlock(tr, target.pos, taken);
    finishTableMove(tr, target.pos, node, axis, block, gap);
  });
  return { between, after };
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
    expect(tableIndexAt(doc, findTableByIndex(doc, 1)?.pos ?? -1)).toBe(1);
    expect(tableIndexAt(doc, 0)).toBe(-1);
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

describe("moving rows and columns", () => {
  const rows = [
    ["h:Item", "h:State", "h:Notes"],
    ["Alpha", "Draft", "First"],
    ["Beta", "Ready", "Second"],
  ];

  it("moves a row up, with its colour", () => {
    const coloured = edit(table(rows, { headerRow: true }), (tr, target) =>
      setRowColor(tr, target, 2, "blue_bg"),
    );

    const moved = edit(coloured, (tr, target) =>
      moveTableRows(tr, target, { start: 2, end: 3 }, 1),
    );
    expect(cells(moved)).toEqual([
      ["h:Item", "h:State", "h:Notes"],
      ["Beta", "Ready", "Second"],
      ["Alpha", "Draft", "First"],
    ]);
    expect([0, 1, 2].map((row) => getRowColor(moved, row))).toEqual([
      null,
      "blue_bg",
      null,
    ]);
  });

  it("moves rows down past the last row", () => {
    const moved = edit(table([["A"], ["B"], ["C"], ["D"]]), (tr, target) =>
      moveTableRows(tr, target, { start: 0, end: 2 }, 4),
    );
    expect(cells(moved)).toEqual([["C"], ["D"], ["A"], ["B"]]);
    expect(movedBlockStart({ start: 0, end: 2 }, 4)).toBe(2);
  });

  it("makes the row dropped first the header row", () => {
    const moved = edit(table(rows, { headerRow: true }), (tr, target) =>
      moveTableRows(tr, target, { start: 2, end: 3 }, 0),
    );
    expect(cells(moved)).toEqual([
      ["h:Beta", "h:Ready", "h:Second"],
      ["Item", "State", "Notes"],
      ["Alpha", "Draft", "First"],
    ]);
    expect(getTableHeaders(moved)).toEqual({ row: true, column: false });

    const headerMoved = edit(table(rows, { headerRow: true }), (tr, target) =>
      moveTableRows(tr, target, { start: 0, end: 1 }, 2),
    );
    expect(cells(headerMoved)).toEqual([
      ["h:Alpha", "h:Draft", "h:First"],
      ["Item", "State", "Notes"],
      ["Beta", "Ready", "Second"],
    ]);
  });

  it("leaves the table alone when dropped at its own edges", () => {
    for (const gap of [1, 2]) {
      expect(tableMoveChangesOrder({ start: 1, end: 2 }, gap)).toBe(false);
      const tr = EditorState.create({ doc: docWith(table(rows)) }).tr;
      moveTableRows(tr, firstTable(tr.doc), { start: 1, end: 2 }, gap);
      moveTableColumns(tr, firstTable(tr.doc), { start: 1, end: 2 }, gap);
      expect(tr.docChanged).toBe(false);
    }
  });

  it("moves a column left, with its colour and width", () => {
    const coloured = edit(table(rows), (tr, target) => {
      setColumnColor(tr, target, 2, "red");
      setColumnColor(tr, target, 0, "blue");
    });

    const moved = edit(coloured, (tr, target) =>
      moveTableColumns(tr, target, { start: 2, end: 3 }, 1),
    );
    expect(cells(moved)).toEqual([
      ["h:Item", "h:Notes", "h:State"],
      ["Alpha", "First", "Draft"],
      ["Beta", "Second", "Ready"],
    ]);
    expect(columnColors(moved)).toEqual(["blue", "red", null]);
    expect(moved.attrs.colMeta).toEqual([{ color: "blue" }, { color: "red" }]);
  });

  it("moves a column right, after the last", () => {
    const moved = edit(table(rows), (tr, target) =>
      moveTableColumns(tr, target, { start: 0, end: 1 }, 3),
    );
    expect(cells(moved)).toEqual([
      ["h:State", "h:Notes", "h:Item"],
      ["Draft", "First", "Alpha"],
      ["Ready", "Second", "Beta"],
    ]);
  });

  it("makes the column dropped first the header column", () => {
    const node = table(
      [
        ["h:Item", "State"],
        ["h:Alpha", "Draft"],
      ],
      { headerColumn: true },
    );
    const moved = edit(node, (tr, target) =>
      moveTableColumns(tr, target, { start: 1, end: 2 }, 0),
    );
    expect(cells(moved)).toEqual([
      ["h:State", "Item"],
      ["h:Draft", "Alpha"],
    ]);
    expect(getTableHeaders(moved)).toEqual({ row: false, column: true });
  });

  it("moves in two changes as it does in one, leaving a whole table between", () => {
    const coloured = edit(table(rows, { headerRow: true }), (tr, target) => {
      setColumnColor(tr, target, 2, "red");
      setRowColor(tr, target, 2, "blue_bg");
    });
    const moves = [
      ["row", { start: 2, end: 3 }, 0],
      ["row", { start: 0, end: 1 }, 3],
      ["column", { start: 2, end: 3 }, 0],
      ["column", { start: 0, end: 2 }, 3],
    ] as const;
    for (const [axis, block, gap] of moves) {
      const once = edit(coloured, (tr, target) =>
        axis === "row"
          ? moveTableRows(tr, target, block, gap)
          : moveTableColumns(tr, target, block, gap),
      );
      const { between, after } = moveInTwoChanges(coloured, axis, block, gap);
      between.check();
      expect(TableMap.get(between).problems).toBeNull();
      expect(after.toJSON()).toEqual(once.toJSON());
    }
  });
});

describe("moving rows and columns on a page with a live copy", () => {
  function moveWhileTyping(
    node: ProseMirrorNode,
    axis: TableAxis,
    block: TableSpan,
    gap: number,
    typed: [row: number, column: number],
  ) {
    const here = new Y.Doc();
    const binding = { mapping: new Map(), isOMark: new Map() };
    let doc = docWith(node);
    updateYFragment(here, here.getXmlFragment("default"), doc, binding);

    const there = new Y.Doc();
    Y.applyUpdate(there, Y.encodeStateAsUpdate(here));
    const theirTable = there.getXmlFragment("default").get(1) as Y.XmlElement;
    const theirCell = (theirTable.get(typed[0]) as Y.XmlElement).get(
      typed[1],
    ) as Y.XmlElement;
    const text = (theirCell.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text.insert(text.length, "!");

    const { between, after } = moveInTwoChanges(node, axis, block, gap);
    for (const next of [between, after]) {
      doc = docWith(next);
      updateYFragment(here, here.getXmlFragment("default"), doc, binding);
    }

    Y.applyUpdate(there, Y.encodeStateAsUpdate(here));
    Y.applyUpdate(here, Y.encodeStateAsUpdate(there));
    const [ours, theirs] = [here, there].map((ydoc) => {
      const page = initProseMirrorDoc(ydoc.getXmlFragment("default"), schema);
      return cells(firstTable(page.doc).node);
    });
    expect(theirs).toEqual(ours);
    return ours;
  }

  it("keeps a collaborator's typing in the row they typed it in", () => {
    const node = table([["A"], ["B"], ["C"], ["D"]]);
    expect(
      moveWhileTyping(node, "row", { start: 2, end: 3 }, 0, [1, 0]),
    ).toEqual([["C"], ["A"], ["B!"], ["D"]]);
    expect(
      moveWhileTyping(node, "row", { start: 0, end: 1 }, 4, [3, 0]),
    ).toEqual([["B"], ["C"], ["D!"], ["A"]]);
  });

  it("keeps a collaborator's typing in the column they typed it in", () => {
    const node = table([
      ["A", "B", "C"],
      ["D", "E", "F"],
    ]);
    expect(
      moveWhileTyping(node, "column", { start: 2, end: 3 }, 0, [1, 1]),
    ).toEqual([
      ["C", "A", "B"],
      ["F", "D", "E!"],
    ]);
  });
});

describe("a merged cell's rows and columns", () => {
  // A table whose first cell spans `span` columns or rows.
  function withMergedCell(span: "colspan" | "rowspan", rows: string[][]) {
    const merged = schema.node(
      "tableCell",
      { [span]: 2 },
      schema.node("paragraph", null, schema.text("A")),
    );
    const node = schema.node(
      "table",
      null,
      rows.map((row, index) =>
        schema.node("tableRow", null, [
          ...(index === 0 ? [merged] : []),
          ...row.map(cell),
        ]),
      ),
    );
    const map = TableMap.get(node);
    return { node, span: map.findCell(map.positionAt(0, 0, node)) };
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

  it("counts and resizes a table by its grid when its first row has a merged cell", () => {
    // The first row has two cells, but the table is three columns wide.
    const { node } = withMergedCell("colspan", [["C"], ["D", "E", "F"]]);
    expect(tableGridSize(node)).toEqual({ rows: 2, columns: 3 });

    const wider = edit(node, (tr, target) =>
      setTableColumnCount(tr, target, 4),
    );
    expect(tableGridSize(wider)).toEqual({ rows: 2, columns: 4 });
    expect(cells(wider)).toEqual([
      ["A", "C", ""],
      ["D", "E", "F", ""],
    ]);

    const narrower = edit(node, (tr, target) =>
      setTableColumnCount(tr, target, 2),
    );
    expect(tableGridSize(narrower)).toEqual({ rows: 2, columns: 2 });
    expect(cells(narrower)).toEqual([["A"], ["D", "E"]]);

    const taller = edit(node, (tr, target) => setTableRowCount(tr, target, 3));
    expect(tableGridSize(taller)).toEqual({ rows: 3, columns: 3 });
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
    expect(next.child(0).child(0).attrs.colspan).toBe(3);
    expect(columnColors(next)).toEqual([null, "red", "red", null]);
    expect(TableMap.get(next).problems).toBeNull();
  });

  it("copies a cell merged down a column once, over the same rows", () => {
    const { node } = withMergedCell("rowspan", [["B"], ["C"], ["D", "E"]]);

    const next = tableWithDuplicatedColumn(node, 0);
    expect(cells(next)).toEqual([["A", "A", "B"], ["C"], ["D", "D", "E"]]);
    expect(next.child(0).child(1).attrs.rowspan).toBe(2);
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

  it("moves a cell merged down rows with all of its rows, never between them", () => {
    const { node } = withMergedCell("rowspan", [["B"], ["C"], ["D", "E"]]);
    expect(tableMoveGaps(node, "row")).toEqual([0, 2, 3]);
    expect(tableMoveGaps(node, "column")).toEqual([0, 1, 2]);
    expect(tableMoveBlock(node, "row", { start: 1, end: 2 })).toEqual({
      start: 0,
      end: 2,
    });

    const moved = edit(node, (tr, target) =>
      moveTableRows(tr, target, { start: 0, end: 2 }, 3),
    );
    expect(cells(moved)).toEqual([["D", "E"], ["A", "B"], ["C"]]);
    expect(moved.child(1).child(0).attrs.rowspan).toBe(2);
    expect(TableMap.get(moved).problems).toBeNull();
  });

  it("moves a column past a cell merged down rows, each row moving its own cells", () => {
    const { node } = withMergedCell("rowspan", [
      ["B", "C"],
      ["D", "E"],
    ]);

    const moved = edit(node, (tr, target) =>
      moveTableColumns(tr, target, { start: 2, end: 3 }, 0),
    );
    expect(cells(moved)).toEqual([
      ["C", "A", "B"],
      ["E", "D"],
    ]);
    expect(TableMap.get(moved).problems).toBeNull();
    const map = TableMap.get(moved);
    expect(moved.nodeAt(map.positionAt(1, 2, moved))?.textContent).toBe("D");
  });

  it("moves a column past a cell merged down rows in two changes as it does in one", () => {
    const { node } = withMergedCell("rowspan", [
      ["B", "C"],
      ["D", "E"],
    ]);
    for (const [block, gap] of [
      [{ start: 2, end: 3 }, 0],
      [{ start: 0, end: 1 }, 3],
    ] as const) {
      const once = edit(node, (tr, target) =>
        moveTableColumns(tr, target, block, gap),
      );
      const { between, after } = moveInTwoChanges(node, "column", block, gap);
      between.check();
      expect(TableMap.get(between).problems).toBeNull();
      expect(after.toJSON()).toEqual(once.toJSON());
    }
  });

  it("moves a column holding all of a row's own cells in two changes, leaving that row empty between", () => {
    const { node } = withMergedCell("rowspan", [["B"], ["C"]]);
    const block = { start: 1, end: 2 };

    const once = edit(node, (tr, target) =>
      moveTableColumns(tr, target, block, 0),
    );
    expect(cells(once)).toEqual([["B", "A"], ["C"]]);
    const { between, after } = moveInTwoChanges(node, "column", block, 0);
    between.check();
    expect(cells(between)).toEqual([["A"], []]);
    expect(TableMap.get(between).problems).toBeNull();
    expect(after.toJSON()).toEqual(once.toJSON());
    const map = TableMap.get(after);
    expect(after.nodeAt(map.positionAt(1, 0, after))?.textContent).toBe("C");
  });

  it("moves a cell merged across columns with all of its columns", () => {
    const { node } = withMergedCell("colspan", [["C"], ["D", "E", "F"]]);
    expect(tableMoveGaps(node, "column")).toEqual([0, 2, 3]);
    expect(tableMoveBlock(node, "column", { start: 1, end: 2 })).toEqual({
      start: 0,
      end: 2,
    });

    const moved = edit(node, (tr, target) =>
      moveTableColumns(tr, target, { start: 0, end: 2 }, 3),
    );
    expect(cells(moved)).toEqual([
      ["C", "A"],
      ["F", "D", "E"],
    ]);
    expect(TableMap.get(moved).problems).toBeNull();
  });
});

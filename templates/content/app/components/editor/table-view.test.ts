// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import { history, undo, undoDepth } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  columnResizing,
  columnResizingPluginKey,
  updateColumnsOnResize,
} from "@tiptap/pm/tables";
import {
  EditorView,
  type Decoration,
  type DecorationSet,
} from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLUMN_SIZING_ATTRIBUTE,
  ContentTableView,
  fitTableColumns,
  READABLE_TABLE_COLUMN_MIN_WIDTH,
  READABLE_TABLE_MIN_WIDTH_PROPERTY,
  contentTableColumnSizing,
  readableTableMinWidth,
  renderedColumnWidths,
  storeColumnWidths,
} from "./table-view";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

function table(
  cells: Array<{ colspan?: number; colwidth?: number[] | null }>,
  attrs: Record<string, unknown> | null = null,
) {
  return schema.node("table", attrs, [
    schema.node(
      "tableRow",
      null,
      cells.map((attrs) =>
        schema.node(
          "tableCell",
          { colspan: 1, colwidth: null, ...attrs },
          schema.node("paragraph"),
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

  it("keeps a table no one has sized content-sized, without the floor", () => {
    const view = new ContentTableView(
      table([{}, {}], { fitPageWidth: true }),
      25,
    );

    expect(view.table.getAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe("content");
    expect(floorOf(view)).toBe("");
  });

  it("keeps its shares when an update writes the widths back in pixels", async () => {
    const fitted = () =>
      table([{ colwidth: [150] }, { colwidth: [50] }], { fitPageWidth: true });
    const view = new ContentTableView(fitted(), 25);

    expect(view.update(fitted())).toBe(true);
    await Promise.resolve();

    expect(widthsOf(view.colgroup)).toEqual(["75.000%", "25.000%"]);
    expect(view.table.hasAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe(false);
  });
});

const plugin = contentTableColumnSizing();

function stateWith(
  tableNode: ProseMirrorNode,
  selectionPos: number,
  focused = true,
) {
  const doc = schema.nodes.doc.create(null, [
    tableNode,
    schema.nodes.paragraph.create(),
  ]);
  const state = EditorState.create({
    doc,
    plugins: [plugin],
    selection: TextSelection.create(doc, selectionPos),
  });
  return state.apply(state.tr.setMeta(plugin, focused));
}

function holdDecorations(state: EditorState): Decoration[] {
  const set = plugin.props.decorations?.call(plugin, state) as
    | DecorationSet
    | null
    | undefined;
  return set ? set.find() : [];
}

// Tiptap's view leaves the rows to ProseMirror, so the tests lay out the first
// row themselves with the widths the browser would have given it, in a page
// `pageWidth` px wide.
function renderFirstRow(view: ContentTableView, widths: number[]) {
  view.contentDOM.replaceChildren();
  const row = view.contentDOM.appendChild(document.createElement("tr"));
  widths.forEach(() => row.appendChild(document.createElement("td")));
  layOut(row, widths);
  return row;
}

/** Gives the row's cells the widths the browser would lay them out at. */
function layOut(row: HTMLTableRowElement, widths: number[]) {
  widths.forEach((width, index) => {
    const cell = row.cells.item(index);
    if (cell)
      cell.getBoundingClientRect = () => ({ width, left: 0 }) as DOMRect;
  });
}

const pageWidth = 600;
const views: ContentTableView[] = [];

function laidOut(node: ProseMirrorNode) {
  const view = new ContentTableView(node, 25);
  Object.defineProperty(view.dom, "clientWidth", { value: pageWidth });
  document.body.append(view.dom);
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }
});

// The table is measured once ProseMirror has drawn its cells, in a microtask.
function cellsDrawn() {
  return Promise.resolve();
}

function colWidths(view: ContentTableView) {
  return Array.from(view.colgroup.children).map(
    (col) => (col as HTMLElement).style.width,
  );
}

const pixels = (view: ContentTableView) =>
  colWidths(view).map((width) => Number.parseFloat(width));

/** The first two columns' widths, in px. */
function firstTwo(view: ContentTableView) {
  const widths = pixels(view);
  if (widths.length < 2)
    throw new Error("The table has fewer than two columns");
  const [first, second] = widths as [number, number, ...number[]];
  return { first, second };
}

describe("content-sized columns", () => {
  it("sizes a table nobody has resized to its content", () => {
    const view = new ContentTableView(table([{}, {}]), 25);

    expect(view.table.getAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe("content");
  });

  it("leaves a resized table to its stored widths", () => {
    const partly = new ContentTableView(table([{ colwidth: [200] }, {}]), 25);
    const fully = new ContentTableView(
      table([{ colwidth: [200] }, { colwidth: [80] }]),
      25,
    );

    expect(partly.table.hasAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe(false);
    expect(fully.table.hasAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe(false);
  });

  it("measures the table once its cells are drawn and fills the page", async () => {
    const node = table([{}, {}]);
    const view = laidOut(node);
    renderFirstRow(view, [100, 300]);

    view.update(node, []);
    await cellsDrawn();

    expect(view.table.getAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe("measured");
    const { first, second } = firstTwo(view);
    expect(first + second).toBeCloseTo(pageWidth, 1);
    expect(second).toBeGreaterThan(first);
    expect(floorOf(view)).toBe("0px");
  });

  it("holds the widths while the selection is in the table, then measures again", async () => {
    const node = table([{}, {}]);
    const view = laidOut(node);
    const row = renderFirstRow(view, [100, 300]);
    view.update(node, []);
    await cellsDrawn();
    const before = colWidths(view);
    const inside = holdDecorations(stateWith(node, 4));

    // oracle-change: the hold keeps measured pixel widths instead of #8152's
    // percentages, so its "held" state, percentage and floor checks went.
    // Typing reflows nothing, though the text, and so its widths, changed.
    layOut(row, [300, 100]);
    view.update(table([{}, {}]), inside);
    await cellsDrawn();
    expect(colWidths(view)).toEqual(before);

    view.update(node, []);
    await cellsDrawn();
    const { first, second } = firstTwo(view);
    expect(first).toBeGreaterThan(second);
  });

  it("measures a held table again once it has another column", async () => {
    const node = table([{}, {}]);
    const view = laidOut(node);
    renderFirstRow(view, [100, 300]);
    view.update(node, []);
    await cellsDrawn();

    // An update can start a hold and change the cells at once, as an undo
    // that puts the caret back in the table does; ProseMirror draws the new
    // cells after `update` returns.
    const wider = table([{}, {}, {}]);
    view.update(wider, holdDecorations(stateWith(wider, 4)));
    expect(view.table.getAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe("content");
    renderFirstRow(view, [100, 100, 200]);
    await cellsDrawn();

    expect(view.table.getAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe("measured");
    expect(pixels(view)).toHaveLength(3);
  });

  it("drops its widths once the table has stored widths", async () => {
    const node = table([{}, {}]);
    const view = laidOut(node);
    renderFirstRow(view, [100, 300]);
    view.update(node, []);
    await cellsDrawn();

    // The second column is left unsized, as a drag leaves the one after it.
    view.update(table([{ colwidth: [150] }, { colwidth: [0] }]));

    expect(view.table.hasAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe(false);
    expect(colWidths(view)).toEqual(["150px", ""]);
    expect(floorOf(view)).toBe(`${150 + READABLE_TABLE_COLUMN_MIN_WIDTH}px`);
  });

  it("clears the widths an undone resize leaves on the columns", () => {
    const view = new ContentTableView(
      table([{ colwidth: [150] }, { colwidth: [150] }]),
      25,
    );

    view.update(table([{}, {}]));

    expect(view.table.getAttribute(COLUMN_SIZING_ATTRIBUTE)).toBe("content");
    expect(colWidths(view)).toEqual(["", ""]);
  });
});

describe("contentTableColumnSizing", () => {
  it("marks the content-sized table holding the caret while focused", () => {
    const node = table([{}, {}]);

    expect(holdDecorations(stateWith(node, 4))).toHaveLength(1);
    expect(holdDecorations(stateWith(node, 4, false))).toHaveLength(0);
    expect(holdDecorations(stateWith(node, node.nodeSize + 1))).toHaveLength(0);
    expect(
      holdDecorations(stateWith(table([{ colwidth: [120] }, {}]), 4)),
    ).toHaveLength(0);
  });

  it("stores each column's width, split across spanning cells", () => {
    const state = stateWith(table([{ colspan: 2 }, {}]), 4);

    expect(storedWidths(storeColumnWidths(state, 0, [50.4, 60, 69.6]))).toEqual(
      [[50, 60], [70]],
    );
    expect(storeColumnWidths(state, 0, [50, 60])).toBeNull();
  });

  it("keeps the widths a drag has already stored", () => {
    const state = stateWith(table([{ colwidth: [80] }, {}, {}]), 4);

    expect(storedWidths(storeColumnWidths(state, 0, [50, 60, 70], 2))).toEqual([
      [80],
      [60],
      [0],
    ]);
  });

  it("reads each column from a cell it has to itself", () => {
    const row = (spans: number[]) =>
      schema.nodes.tableRow.create(
        null,
        spans.map((colspan) =>
          schema.nodes.tableCell.create(
            { colspan },
            schema.nodes.paragraph.create(),
          ),
        ),
      );
    // The middle column has no cell of its own, so it gets what's left of
    // the cell spanning it.
    const node = schema.nodes.table.create(null, [row([2, 1]), row([1, 2])]);
    const dom = document.createElement("table");
    for (const widths of [
      [300, 50],
      [100, 250],
    ]) {
      const tr = dom.insertRow();
      for (const width of widths) {
        tr.insertCell().getBoundingClientRect = () => ({ width }) as DOMRect;
      }
    }

    expect(renderedColumnWidths(node, dom)).toEqual([100, 200, 50]);
  });

  it("leaves the column after the dragged border unsized to fill the rest", () => {
    const state = stateWith(table([{}, {}, {}]), 4);

    expect(storedWidths(storeColumnWidths(state, 0, [50, 60, 70], 1))).toEqual([
      [50],
      [0],
      [70],
    ]);
  });

  it("lets a tap beside a column border reach the cell", () => {
    const sizing = contentTableColumnSizing();
    const resizing = columnResizing();
    const doc = schema.nodes.doc.create(null, [
      table([{ colwidth: [120] }, {}]),
    ]);
    const view = {
      editable: true,
      state: EditorState.create({ doc, plugins: [sizing, resizing] }),
      dispatch(tr: Transaction) {
        view.state = view.state.apply(tr);
      },
    };
    const press = (pointerType: string) => {
      view.dispatch(
        view.state.tr.setMeta(columnResizingPluginKey, { setHandle: 2 }),
      );
      const events = sizing.props.handleDOMEvents!;
      const editorView = view as unknown as EditorView;
      events.pointerdown!.call(sizing, editorView, { pointerType } as never);
      events.mousedown!.call(sizing, editorView, {} as MouseEvent);
      return columnResizingPluginKey.getState(view.state)?.activeHandle;
    };

    expect(press("touch")).toBe(-1);
    expect(press("mouse")).toBe(2);
  });
});

describe("dragging a content-sized table's border", () => {
  afterEach(() => vi.restoreAllMocks());

  // Presses the first column's right border at x = 100, with every column
  // rendered 100px wide.
  function pressBorder() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100,
    } as DOMRect);
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [table([{}, {}, {}])]),
      plugins: [contentTableColumnSizing(), columnResizing(), history()],
    });
    const view = new EditorView(
      document.body.appendChild(document.createElement("div")),
      { state },
    );
    view.dispatch(
      view.state.tr.setMeta(columnResizingPluginKey, { setHandle: 2 }),
    );
    view.dom
      .querySelector("td")!
      .dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 100 }),
      );
    return view;
  }

  function columnWidthsOf(view: EditorView) {
    const widths: unknown[] = [];
    view.state.doc.firstChild?.firstChild?.forEach((cell) =>
      widths.push(cell.attrs.colwidth),
    );
    return widths;
  }

  it("stores nothing when the border doesn't move", () => {
    const view = pressBorder();
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100 }));

    expect(columnWidthsOf(view)).toEqual([null, null, null]);
    expect(undoDepth(view.state)).toBe(0);
    view.destroy();
  });

  it("makes a drag released outside the window one undo step", () => {
    const view = pressBorder();
    // `columnResizing` ends such a drag on the next mousemove, with no button.
    const reentry = new MouseEvent("mousemove", { clientX: 140 });
    Object.defineProperty(reentry, "which", { value: 0 });
    window.dispatchEvent(reentry);

    expect(columnWidthsOf(view)).toEqual([[140], [0], [100]]);
    undo(view.state, view.dispatch);
    expect(columnWidthsOf(view)).toEqual([null, null, null]);
    view.destroy();
  });
});

function storedWidths(tr: ReturnType<typeof storeColumnWidths>) {
  const widths: unknown[] = [];
  tr?.doc.firstChild?.forEach((row) =>
    row.forEach((cell) => widths.push(cell.attrs.colwidth)),
  );
  return widths;
}

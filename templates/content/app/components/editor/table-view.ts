import { TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { TableMap, columnResizingPluginKey } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// The table's CSS keeps it at least as wide as the page, so this floor only
// matters once unresized columns stop fitting: the table then scrolls inside
// `.tableWrapper` instead of squeezing each column to a letter per line.
// Tiptap's `cellMinWidth` stays small because it is also the drag minimum.
export const READABLE_TABLE_COLUMN_MIN_WIDTH = 96;

// Column drags rewrite the table's inline `min-width` on every frame, so the
// floor lives in a custom property that the stylesheet enforces instead.
export const READABLE_TABLE_MIN_WIDTH_PROPERTY = "--content-table-min-width";

// A table nobody has resized sizes its columns to their content, the way a
// Markdown table does on GitHub, rather than splitting the page evenly. The
// widths are never saved, so they follow the page width and the text.
// "content" lets the browser size the columns; "held" keeps the widths it
// chose while the caret is in the table, so typing doesn't move them.
export const COLUMN_SIZING_ATTRIBUTE = "data-column-sizing";

const HOLD_COLUMN_WIDTHS = "contentTableHoldColumnWidths";

export function readableTableMinWidth(colgroup: HTMLElement): number | null {
  let total = 0;
  let hasUnsizedColumn = false;
  for (const col of Array.from(colgroup.children)) {
    // Stored widths are pixels; a held content-sized width is a percentage.
    const { width } = (col as HTMLElement).style;
    const pixels = width.endsWith("px") ? Number.parseFloat(width) : 0;
    if (pixels > 0) {
      total += pixels;
    } else {
      total += READABLE_TABLE_COLUMN_MIN_WIDTH;
      hasUnsizedColumn = true;
    }
  }
  return hasUnsizedColumn ? total : null;
}

// Fit to width keeps each sized column's share of the table, so the table
// never outgrows the page. Tiptap writes the widths back in pixels on every
// update and resize step; unsized columns share what the sized ones leave.
export function fitTableColumns(colgroup: HTMLElement) {
  const cols = Array.from(colgroup.children) as HTMLElement[];
  if (cols.some((col) => col.style.width.endsWith("%"))) return;
  const widths = cols.map((col) => Number.parseFloat(col.style.width) || 0);
  if (widths.every((width) => width === 0)) return;
  const total = widths.reduce(
    (sum, width) => sum + (width || READABLE_TABLE_COLUMN_MIN_WIDTH),
    0,
  );
  cols.forEach((col, index) => {
    if (widths[index]) {
      col.style.width = `${((widths[index] / total) * 100).toFixed(3)}%`;
    }
  });
}

export function hasStoredColumnWidths(table: ProseMirrorNode): boolean {
  let stored = false;
  table.forEach((row) =>
    row.forEach((cell) => {
      if (cell.attrs.colwidth?.some((width: number) => width > 0)) {
        stored = true;
      }
    }),
  );
  return stored;
}

/**
 * Each column's rendered width. A cell spanning several columns doesn't show
 * how the browser divided them, so a column is read from a cell it has to
 * itself, in any row; only a column without one shares out what its spanning
 * cell has left. Null when the rendered cells don't match `node`'s yet.
 */
export function renderedColumnWidths(
  node: ProseMirrorNode,
  table: HTMLTableElement,
): number[] | null {
  if (table.rows.length !== node.childCount) return null;
  const map = TableMap.get(node);
  const widths: Array<number | undefined> = new Array(map.width);
  const spanning: Array<{ start: number; span: number; width: number }> = [];
  let rowPos = 0;
  let current = true;
  node.forEach((row, _offset, rowIndex) => {
    const { cells } = table.rows[rowIndex];
    if (cells.length !== row.childCount) current = false;
    if (!current) return;
    row.forEach((cell, cellOffset, cellIndex) => {
      const width = cells[cellIndex].getBoundingClientRect().width;
      const start = map.colCount(rowPos + 1 + cellOffset);
      const span: number = cell.attrs.colspan;
      if (span === 1) widths[start] ??= width;
      else spanning.push({ start, span, width });
    });
    rowPos += row.nodeSize;
  });
  if (!current) return null;
  for (const { start, span, width } of spanning) {
    const columns = Array.from({ length: span }, (_, index) => start + index);
    const unknown = columns.filter((column) => widths[column] === undefined);
    const known = columns.reduce(
      (sum, column) => sum + (widths[column] ?? 0),
      0,
    );
    for (const column of unknown) {
      widths[column] = Math.max(0, width - known) / unknown.length;
    }
  }
  return Array.from(widths, (width) => width ?? 0);
}

/**
 * Stores `widths` as the width of each column that has none, except
 * `flexibleColumn`, which stays unsized and so takes whatever width the others
 * leave. A drag stores only the column it moves, which would leave the rest of
 * a content-sized table to share what's left evenly; instead the first drag
 * keeps the widths the browser chose, and the column after the border gives or
 * takes the difference, so only the dragged border moves.
 */
export function storeColumnWidths(
  state: EditorState,
  tablePos: number,
  widths: number[],
  flexibleColumn = -1,
): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const map = TableMap.get(table);
  if (widths.length !== map.width) return null;
  const tr = state.tr;
  for (const pos of new Set(map.map)) {
    const cell = table.nodeAt(pos);
    if (!cell) continue;
    const start = map.colCount(pos);
    const stored: number[] | null = cell.attrs.colwidth;
    const colwidth = widths
      .slice(start, start + cell.attrs.colspan)
      .map((width, index) => {
        if (stored?.[index]) return stored[index];
        return start + index === flexibleColumn ? 0 : Math.round(width);
      });
    if (stored && colwidth.every((width, index) => width === stored[index])) {
      continue;
    }
    tr.setNodeMarkup(tablePos + 1 + pos, null, { ...cell.attrs, colwidth });
  }
  return tr.docChanged ? tr : null;
}

function clearColumnWidths(state: EditorState, tablePos: number) {
  const tr = state.tr;
  state.doc.nodeAt(tablePos)?.descendants((node, pos) => {
    if (node.type.spec.tableRole === "row") return true;
    if (node.attrs.colwidth) {
      tr.setNodeMarkup(tablePos + 1 + pos, null, {
        ...node.attrs,
        colwidth: null,
      });
    }
    return false;
  });
  return tr;
}

function selectedContentSizedTable(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.spec.tableRole !== "table") continue;
    if (hasStoredColumnWidths(node)) return null;
    return { node, pos: $from.before(depth) };
  }
  return null;
}

interface ContentSizedResize {
  widths: number[];
  flexibleColumn: number;
}

/** The table holding the resize handle, while it has one. */
function resizedTable(state: EditorState) {
  const resize = columnResizingPluginKey.getState(state);
  if (!resize || resize.activeHandle < 0) return null;
  const $cell = state.doc.resolve(resize.activeHandle);
  return { $cell, pos: $cell.before(-1), dragging: resize.dragging };
}

/**
 * Stores a content-sized table's widths as a press on a column border starts
 * a drag, so the drag shows the table it will leave. Undo skips them: the
 * release takes them away and, if the border moved, stores them again in the
 * drag's own undo step.
 */
function startContentSizedResize(view: EditorView): ContentSizedResize | null {
  const handle = resizedTable(view.state);
  if (!view.editable || !handle || handle.dragging) return null;
  const { $cell } = handle;
  const table = $cell.node(-1);
  if (hasStoredColumnWidths(table)) return null;
  let dom: Node | null = view.domAtPos($cell.start(-1)).node;
  while (dom && dom.nodeName !== "TABLE") dom = dom.parentNode;
  if (!dom) return null;
  // The handle sits on the right edge of the column being dragged.
  const map = TableMap.get(table);
  const dragged =
    map.colCount($cell.pos - $cell.start(-1)) +
    ($cell.nodeAfter?.attrs.colspan ?? 1) -
    1;
  const widths = renderedColumnWidths(table, dom as HTMLTableElement);
  if (!widths) return null;
  const resize = {
    widths,
    flexibleColumn: dragged + 1 < map.width ? dragged + 1 : -1,
  };
  const tr = storeColumnWidths(
    view.state,
    handle.pos,
    resize.widths,
    resize.flexibleColumn,
  );
  if (!tr) return null;
  view.dispatch(tr.setMeta("addToHistory", false));
  return resize;
}

// A touch screen sends a tap's mouse events only once the finger lifts, so a
// tap can't drag a column border; `columnResizing` would still take a tap
// beside one as the start of a drag, and the tap would never reach the cell.
function releaseColumnHandle(view: EditorView) {
  const resize = columnResizingPluginKey.getState(view.state);
  if (!resize || resize.activeHandle < 0 || resize.dragging) return;
  view.dispatch(
    view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }),
  );
}

/**
 * Marks the content-sized table holding the caret, while the editor has focus,
 * so its view keeps its column widths; stores a content-sized table's widths
 * when a column drag starts; and keeps a tap from starting one. It must come
 * before `columnResizing`, whose mousedown starts the drag and whose mouseup
 * ends it.
 */
export function contentTableColumnSizing() {
  // A page opens with its selection at the start, inside a leading table,
  // before anyone edits it, so holding follows focus as well as the selection.
  const key = new PluginKey<boolean>("contentTableColumnSizing");
  const setFocused = (view: EditorView, focused: boolean) => {
    if (key.getState(view.state) === focused) return false;
    view.dispatch(
      view.state.tr.setMeta(key, focused).setMeta("addToHistory", false),
    );
    return false;
  };
  let touching = false;
  // The content-sized table's drag under way, and the one being released.
  let pending: ContentSizedResize | null = null;
  let releasing: ContentSizedResize | null = null;

  // Runs just before `columnResizing` writes the dragged width. Taking the
  // widths away first lets that write and the widths the plugin puts back
  // (in `appendTransaction`) be one undo step from a content-sized table.
  const release = (
    view: EditorView,
    resize: ContentSizedResize,
    event: MouseEvent,
  ) => {
    if (pending !== resize) return;
    pending = null;
    const handle = resizedTable(view.state);
    if (!handle?.dragging) return;
    const tr = clearColumnWidths(view.state, handle.pos).setMeta(
      "addToHistory",
      false,
    );
    if (event.clientX === handle.dragging.startX) {
      // The border didn't move, so nothing is stored.
      view.dispatch(tr.setMeta(columnResizingPluginKey, { setDragging: null }));
      return;
    }
    view.dispatch(tr);
    releasing = resize;
  };

  return new Plugin({
    key,
    state: {
      init: () => false,
      apply: (tr, focused) => tr.getMeta(key) ?? focused,
    },
    appendTransaction(transactions, _oldState, state) {
      if (!releasing) return null;
      const handle = resizedTable(state);
      if (!handle?.dragging) {
        releasing = null;
        return null;
      }
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const { widths, flexibleColumn } = releasing;
      releasing = null;
      return storeColumnWidths(state, handle.pos, widths, flexibleColumn);
    },
    props: {
      decorations(state) {
        if (!key.getState(state)) return null;
        const table = selectedContentSizedTable(state);
        if (!table) return null;
        return DecorationSet.create(state.doc, [
          Decoration.node(
            table.pos,
            table.pos + table.node.nodeSize,
            {},
            { [HOLD_COLUMN_WIDTHS]: true },
          ),
        ]);
      },
      handleDOMEvents: {
        focus: (view) => setFocused(view, true),
        blur: (view) => setFocused(view, false),
        pointerdown(_view, event) {
          touching = event.pointerType === "touch";
          return false;
        },
        mousedown(view) {
          pending = null;
          if (touching) {
            releaseColumnHandle(view);
            return false;
          }
          const resize = startContentSizedResize(view);
          if (!resize) return false;
          pending = resize;
          // `columnResizing` ends its drag on the same two events, with
          // listeners added after these, so these run first.
          const win = view.dom.ownerDocument.defaultView ?? window;
          const end = (event: MouseEvent) => {
            win.removeEventListener("mouseup", end);
            win.removeEventListener("mousemove", move);
            release(view, resize, event);
          };
          // A button released outside the window ends the drag on the next
          // mousemove, found the same way `columnResizing` finds it.
          const move = (event: MouseEvent) => {
            if (!event.which) end(event);
          };
          win.addEventListener("mouseup", end);
          win.addEventListener("mousemove", move);
          return false;
        },
      },
    },
  });
}

export class ContentTableView extends TableView {
  // A column drag restyles the <col>s on every frame but writes the new width
  // to the document only on release, so the floor follows the <col>s.
  private readonly columnObserver = new MutationObserver(() =>
    this.applyColumnWidths(),
  );

  // Each column's share of the table, in percent, while its widths are held,
  // and the table's width when they were measured.
  private heldShares: number[] | null = null;
  private heldWidth = 0;
  private holding = false;
  private measuring = false;

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyColumnSizing(false);
    this.applyColumnWidths();
    this.columnObserver.observe(this.colgroup, {
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
  }

  override update(
    node: ProseMirrorNode,
    decorations: readonly Decoration[] = [],
  ) {
    if (!super.update(node)) return false;
    this.applyColumnSizing(
      decorations.some((decoration) => decoration.spec[HOLD_COLUMN_WIDTHS]),
    );
    this.applyColumnWidths();
    return true;
  }

  destroy() {
    this.columnObserver.disconnect();
  }

  private applyColumnSizing(hold: boolean) {
    // Tiptap only sets an unsized <col>'s `min-width`, so widths left by a
    // hold or an undone resize are cleared here.
    const cols = Array.from(this.colgroup.children) as HTMLElement[];
    if (hasStoredColumnWidths(this.node)) {
      // Stored widths are pixels; a percentage is a hold's, on a column
      // left unsized to take up the rest.
      for (const col of cols) {
        if (col.style.width.endsWith("%")) col.style.removeProperty("width");
      }
      this.heldShares = null;
      this.holding = false;
      this.table.removeAttribute(COLUMN_SIZING_ATTRIBUTE);
      return;
    }
    this.holding = hold;
    if (hold && this.heldShares?.length === cols.length) {
      this.applyHeldShares(cols);
      return;
    }
    this.heldShares = null;
    this.table.setAttribute(COLUMN_SIZING_ATTRIBUTE, "content");
    for (const col of cols) col.style.removeProperty("width");
    if (hold) this.measureHeldShares();
  }

  // ProseMirror redraws the cells only after `update`, and an update that
  // starts a hold can also change them (an undo that puts the caret back in
  // the table), so the widths are measured once it has, before the next paint.
  private measureHeldShares() {
    if (this.measuring) return;
    this.measuring = true;
    queueMicrotask(() => {
      this.measuring = false;
      if (!this.holding || this.heldShares) return;
      const cols = Array.from(this.colgroup.children) as HTMLElement[];
      const widths = renderedColumnWidths(this.node, this.table);
      const total = widths?.reduce((sum, width) => sum + width, 0) ?? 0;
      if (!widths || widths.length !== cols.length || total <= 0) return;
      this.heldShares = widths.map((width) => (width / total) * 100);
      this.heldWidth = this.table.getBoundingClientRect().width;
      this.applyHeldShares(cols);
      this.applyColumnWidths();
    });
  }

  private applyHeldShares(cols: HTMLElement[]) {
    this.table.setAttribute(COLUMN_SIZING_ATTRIBUTE, "held");
    cols.forEach((col, index) => {
      col.style.width = `${this.heldShares![index].toFixed(3)}%`;
    });
  }

  private applyColumnWidths() {
    // An editable table's view is built without the table's attributes.
    const fit = this.node.attrs.fitPageWidth === true;
    if (fit) {
      this.table.setAttribute("data-fit-page-width", "true");
      fitTableColumns(this.colgroup);
    } else {
      this.table.removeAttribute("data-fit-page-width");
    }
    let minWidth = fit ? null : readableTableMinWidth(this.colgroup);
    // A word too long for its column widens a content-sized table past the
    // page instead of breaking; a held table keeps that width, so the word
    // doesn't break once the caret is in the table either.
    if (this.heldShares && minWidth !== null) {
      minWidth = Math.max(minWidth, this.heldWidth);
    }
    if (minWidth === null) {
      this.table.style.removeProperty(READABLE_TABLE_MIN_WIDTH_PROPERTY);
    } else {
      this.table.style.setProperty(
        READABLE_TABLE_MIN_WIDTH_PROPERTY,
        `${minWidth}px`,
      );
    }
  }
}

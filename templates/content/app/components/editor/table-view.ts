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

/** Each column's rendered width, read from the table's first row. */
export function renderedColumnWidths(table: HTMLTableElement): number[] {
  const widths: number[] = [];
  for (const cell of Array.from(table.rows[0]?.cells ?? [])) {
    const width = cell.getBoundingClientRect().width / cell.colSpan;
    for (let i = 0; i < cell.colSpan; i += 1) widths.push(width);
  }
  return widths;
}

/**
 * Stores `widths` as each column's width, except `flexibleColumn`, which
 * stays unsized and so takes whatever width the others leave. A drag stores
 * only the column it moves, which would leave the rest of a content-sized
 * table to share what's left evenly; instead the first drag keeps the widths
 * the browser chose, and the column after the border gives or takes the
 * difference, so only the dragged border moves.
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
    const colwidth = widths
      .slice(start, start + cell.attrs.colspan)
      .map((width, index) =>
        start + index === flexibleColumn ? 0 : Math.round(width),
      );
    tr.setNodeMarkup(tablePos + 1 + pos, null, { ...cell.attrs, colwidth });
  }
  return tr.docChanged ? tr : null;
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

function storeColumnWidthsBeforeResize(view: EditorView) {
  const resize = columnResizingPluginKey.getState(view.state);
  if (!view.editable || !resize || resize.activeHandle < 0 || resize.dragging)
    return;
  const $cell = view.state.doc.resolve(resize.activeHandle);
  const table = $cell.node(-1);
  if (!table || hasStoredColumnWidths(table)) return;
  let dom: Node | null = view.domAtPos($cell.start(-1)).node;
  while (dom && dom.nodeName !== "TABLE") dom = dom.parentNode;
  if (!dom) return;
  // The handle sits on the right edge of the column being dragged.
  const map = TableMap.get(table);
  const dragged =
    map.colCount($cell.pos - $cell.start(-1)) +
    ($cell.nodeAfter?.attrs.colspan ?? 1) -
    1;
  const tr = storeColumnWidths(
    view.state,
    $cell.before(-1),
    renderedColumnWidths(dom as HTMLTableElement),
    dragged + 1 < map.width ? dragged + 1 : -1,
  );
  if (tr) view.dispatch(tr);
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
 * before `columnResizing`, whose mousedown starts the drag.
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
  return new Plugin({
    key,
    state: {
      init: () => false,
      apply: (tr, focused) => tr.getMeta(key) ?? focused,
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
          if (touching) releaseColumnHandle(view);
          else storeColumnWidthsBeforeResize(view);
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
    this.applyReadableMinWidth(),
  );

  // Each column's share of the table, in percent, while its widths are held.
  private heldShares: number[] | null = null;

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyColumnSizing(false);
    this.applyReadableMinWidth();
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
    this.applyReadableMinWidth();
    return true;
  }

  destroy() {
    this.columnObserver.disconnect();
  }

  private applyColumnSizing(hold: boolean) {
    if (hasStoredColumnWidths(this.node)) {
      this.heldShares = null;
      this.table.removeAttribute(COLUMN_SIZING_ATTRIBUTE);
      return;
    }
    const cols = Array.from(this.colgroup.children) as HTMLElement[];
    if (!hold || this.heldShares?.length !== cols.length) {
      // Tiptap only sets an unsized <col>'s `min-width`, so widths left by a
      // hold or an undone resize are cleared here.
      this.heldShares = null;
      this.table.setAttribute(COLUMN_SIZING_ATTRIBUTE, "content");
      for (const col of cols) col.style.removeProperty("width");
      if (!hold) return;
      const widths = renderedColumnWidths(this.table);
      const total = widths.reduce((sum, width) => sum + width, 0);
      if (widths.length !== cols.length || total <= 0) return;
      this.heldShares = widths.map((width) => (width / total) * 100);
    }
    this.table.setAttribute(COLUMN_SIZING_ATTRIBUTE, "held");
    cols.forEach((col, index) => {
      col.style.width = `${this.heldShares![index].toFixed(3)}%`;
    });
  }

  private applyReadableMinWidth() {
    const minWidth = readableTableMinWidth(this.colgroup);
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

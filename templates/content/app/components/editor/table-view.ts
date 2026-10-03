import { TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

// The table's CSS keeps it at least as wide as the page, so this floor only
// matters once unresized columns stop fitting: the table then scrolls inside
// `.tableWrapper` instead of squeezing each column to a letter per line.
// Tiptap's `cellMinWidth` stays small because it is also the drag minimum.
export const READABLE_TABLE_COLUMN_MIN_WIDTH = 96;

// Column drags rewrite the table's inline `min-width` on every frame, so the
// floor lives in a custom property that the stylesheet enforces instead.
export const READABLE_TABLE_MIN_WIDTH_PROPERTY = "--content-table-min-width";

export function readableTableMinWidth(node: ProseMirrorNode): number | null {
  const row = node.firstChild;
  if (!row) return null;
  let total = 0;
  let hasUnsizedColumn = false;
  row.forEach((cell) => {
    const colspan: number = cell.attrs.colspan ?? 1;
    const colwidth: number[] | null = cell.attrs.colwidth ?? null;
    for (let index = 0; index < colspan; index += 1) {
      const width = colwidth?.[index];
      if (width) {
        total += width;
      } else {
        total += READABLE_TABLE_COLUMN_MIN_WIDTH;
        hasUnsizedColumn = true;
      }
    }
  });
  return hasUnsizedColumn ? total : null;
}

export class ContentTableView extends TableView {
  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyReadableMinWidth();
  }

  override update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    this.applyReadableMinWidth();
    return true;
  }

  private applyReadableMinWidth() {
    const minWidth = readableTableMinWidth(this.node);
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

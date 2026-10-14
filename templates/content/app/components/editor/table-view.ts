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

export function readableTableMinWidth(colgroup: HTMLElement): number | null {
  let total = 0;
  let hasUnsizedColumn = false;
  for (const col of Array.from(colgroup.children)) {
    const width = Number.parseFloat((col as HTMLElement).style.width);
    if (width > 0) {
      total += width;
    } else {
      total += READABLE_TABLE_COLUMN_MIN_WIDTH;
      hasUnsizedColumn = true;
    }
  }
  return hasUnsizedColumn ? total : null;
}

export class ContentTableView extends TableView {
  // A column drag restyles the <col>s on every frame but writes the new width
  // to the document only on release, so the floor follows the <col>s.
  private readonly columnObserver = new MutationObserver(() =>
    this.applyReadableMinWidth(),
  );

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyReadableMinWidth();
    this.columnObserver.observe(this.colgroup, {
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
  }

  override update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    this.applyReadableMinWidth();
    return true;
  }

  destroy() {
    this.columnObserver.disconnect();
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

import {
  TABLE_COLLECTION_MAX_COLUMNS,
  TABLE_COLLECTION_MAX_NAME_LENGTH,
  TABLE_COLLECTION_MAX_ROWS,
  TABLE_COLLECTION_MAX_TITLE_LENGTH,
  type TableCollectionSeed,
} from "@shared/table-collection-seed";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";

import { getTableHeaders, type TableAt } from "./table-commands";

// A cell's text as a text property holds it: its paragraphs and line breaks
// as new lines. Formatting and links stay behind in the table.
function cellText(cell: ProseMirrorNode) {
  return cell
    .textBetween(0, cell.content.size, "\n", (leaf) =>
      leaf.type.name === "hardBreak"
        ? "\n"
        : (leaf.type.spec.leafText?.(leaf) ?? ""),
    )
    .trim();
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The table's cells by row and column. A merged cell's text is in its first. */
function tableGrid(table: ProseMirrorNode) {
  const map = TableMap.get(table);
  return Array.from({ length: map.height }, (_, row) =>
    Array.from({ length: map.width }, (_, column) => {
      const offset = map.map[row * map.width + column];
      const cell = map.findCell(offset);
      if (cell.top !== row || cell.left !== column) return "";
      const node = table.nodeAt(offset);
      return node ? cellText(node) : "";
    }),
  );
}

/** Whether the table fits in a new collection. */
export function tableFitsCollection(table: ProseMirrorNode) {
  const map = TableMap.get(table);
  const rows = map.height - (getTableHeaders(table).row ? 1 : 0);
  return (
    map.width <= TABLE_COLLECTION_MAX_COLUMNS &&
    rows <= TABLE_COLLECTION_MAX_ROWS
  );
}

/**
 * What a new collection takes from the table. The first column titles each
 * row, as a collection's Name column does, and every other column becomes a
 * text property. A header row names the properties and isn't a row itself;
 * without one, they're named for their column.
 */
export function tableCollectionSeed(
  table: ProseMirrorNode,
): TableCollectionSeed {
  const grid = tableGrid(table);
  const hasHeaderRow = getTableHeaders(table).row && grid.length > 0;
  const header = hasHeaderRow ? grid[0] : [];
  const width = grid[0]?.length ?? 0;

  const taken = new Set<string>();
  const properties = Array.from({ length: Math.max(0, width - 1) }, (_, i) => {
    const column = i + 1;
    const base =
      oneLine(header[column] ?? "").slice(
        0,
        TABLE_COLLECTION_MAX_NAME_LENGTH,
      ) || `Column ${column + 1}`;
    let name = base;
    for (let copy = 2; taken.has(name.toLocaleLowerCase()); copy += 1) {
      const suffix = ` ${copy}`;
      name = `${base.slice(0, TABLE_COLLECTION_MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    }
    taken.add(name.toLocaleLowerCase());
    return name;
  });

  const rows = (hasHeaderRow ? grid.slice(1) : grid).map(
    ([title, ...cells]) => [
      oneLine(title ?? "").slice(0, TABLE_COLLECTION_MAX_TITLE_LENGTH),
      ...cells,
    ],
  );
  return { properties, rows };
}

/**
 * The table, if the page still holds it unchanged: where it was, or the
 * nearest copy of it after edits moved it. Null once it has changed or gone.
 */
export function findUnchangedTable(
  doc: ProseMirrorNode,
  table: TableAt,
): TableAt | null {
  let found: TableAt | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    if (
      node.eq(table.node) &&
      (!found || Math.abs(pos - table.pos) < Math.abs(found.pos - table.pos))
    ) {
      found = { node, pos };
    }
    return false;
  });
  return found;
}

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

function tableGrid(table: ProseMirrorNode) {
  const map = TableMap.get(table);
  return Array.from({ length: map.height }, (_, row) =>
    Array.from({ length: map.width }, (_, column) => {
      const offset = map.map.at(row * map.width + column);
      if (offset === undefined) return "";
      const cell = map.findCell(offset);
      if (cell.top !== row || cell.left !== column) return "";
      const node = table.nodeAt(offset);
      return node ? cellText(node) : "";
    }),
  );
}

export function tableFitsCollection(table: ProseMirrorNode) {
  const map = TableMap.get(table);
  const rows = map.height - (getTableHeaders(table).row ? 1 : 0);
  return (
    map.width <= TABLE_COLLECTION_MAX_COLUMNS &&
    rows <= TABLE_COLLECTION_MAX_ROWS
  );
}

export function tableCollectionSeed(
  table: ProseMirrorNode,
): TableCollectionSeed {
  const grid = tableGrid(table);
  const hasHeaderRow = getTableHeaders(table).row;
  const header = (hasHeaderRow && grid.at(0)) || [];
  const width = grid.at(0)?.length ?? 0;

  const taken = new Set<string>();
  const properties = Array.from({ length: Math.max(0, width - 1) }, (_, i) => {
    const column = i + 1;
    const base =
      oneLine(header.at(column) ?? "").slice(
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
    ([title = "", ...cells]) => [
      oneLine(title).slice(0, TABLE_COLLECTION_MAX_TITLE_LENGTH),
      ...cells,
    ],
  );
  return { properties, rows };
}

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

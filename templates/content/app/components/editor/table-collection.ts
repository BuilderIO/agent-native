import {
  TABLE_COLLECTION_MAX_COLUMNS,
  TABLE_COLLECTION_MAX_NAME_LENGTH,
  TABLE_COLLECTION_MAX_ROWS,
  type TableCollectionSeed,
  tableCollectionSeedSchema,
} from "@shared/table-collection-seed";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";

import { anchorTable, findAnchoredTable } from "./table-anchor";
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
    map.map
      .slice(row * map.width, (row + 1) * map.width)
      .map((offset, column) => {
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
  const [top = []] = grid;
  const header = hasHeaderRow ? top : [];
  const width = top.length;

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
    ([title = "", ...cells]) => [oneLine(title), ...cells],
  );
  return { properties, rows };
}

export function seedFitsCollection(seed: TableCollectionSeed) {
  return tableCollectionSeedSchema.safeParse(seed).success;
}

export function followTable(state: EditorState, table: TableAt) {
  const anchor = anchorTable(state, table);
  let pos: number | null = table.pos;
  return {
    map(tr: Transaction) {
      if (anchor.live || pos === null) return;
      const mapped = tr.mapping.mapResult(pos, 1);
      pos = mapped.deleted ? null : mapped.pos;
    },
    find(current: EditorState): TableAt | null {
      let found: TableAt | null = null;
      if (anchor.live) {
        found = findAnchoredTable(current, anchor);
      } else if (pos !== null) {
        const node = current.doc.nodeAt(pos);
        found = node ? { node, pos } : null;
      }
      return found?.node.eq(table.node) ? found : null;
    },
  };
}

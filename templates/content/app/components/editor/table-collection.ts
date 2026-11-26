import {
  TABLE_COLLECTION_MAX_COLUMNS,
  TABLE_COLLECTION_MAX_NAME_LENGTH,
  TABLE_COLLECTION_MAX_ROWS,
  type TableCollectionSeed,
  tableCollectionSeedSchema,
} from "@shared/table-collection-seed";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import { anchorTable, findAnchoredTable } from "./table-anchor";
import { getTableHeaders, type TableAt } from "./table-commands";

function cellText(cell: ProseMirrorNode) {
  return cell
    .textBetween(0, cell.content.size, "\n", (leaf) => {
      if (leaf.type.name === "hardBreak") return "\n";
      const label: unknown = leaf.attrs.label;
      return (
        leaf.type.spec.leafText?.(leaf) ??
        (typeof label === "string" ? label : "")
      );
    })
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

export function replaceBlockAsOneUndoStep(
  view: EditorView,
  target: TableAt,
  replacement: ProseMirrorNode,
  meta: string,
) {
  const tr = view.state.tr.replaceWith(
    target.pos,
    target.pos + target.node.nodeSize,
    replacement,
  );
  tr.setSelection(NodeSelection.create(tr.doc, target.pos));
  const undoManager = yUndoPluginKey.getState(view.state)?.undoManager;
  undoManager?.stopCapturing();
  view.dispatch(closeHistory(tr).setMeta(meta, true).scrollIntoView());
  view.dispatch(closeHistory(view.state.tr));
  undoManager?.stopCapturing();
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

export function findInlineCollection(
  doc: ProseMirrorNode,
  ownerBlockId: string,
): TableAt | null {
  let found: TableAt | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (
      node.type.name === "registryBlock" &&
      node.attrs.blockType === "inline-database" &&
      node.attrs.blockId === ownerBlockId
    ) {
      found = { node, pos };
    }
    return !found;
  });
  return found;
}

function cellContent(text: string) {
  const content = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line, index) => [
      ...(index > 0 ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
  return [{ type: "paragraph", ...(content.length ? { content } : {}) }];
}

export function collectionTableContent(
  header: readonly string[],
  rows: readonly (readonly string[])[],
) {
  const row = (
    cells: readonly string[],
    type: "tableHeader" | "tableCell",
  ) => ({
    type: "tableRow",
    content: cells.map((text) => ({ type, content: cellContent(text) })),
  });
  return {
    type: "table",
    attrs: { headerRow: true },
    content: [
      row(header, "tableHeader"),
      ...rows.map((cells) => row(cells, "tableCell")),
    ],
  };
}

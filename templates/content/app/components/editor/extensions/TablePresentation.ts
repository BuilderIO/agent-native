import { NFM_COLORS } from "@shared/nfm";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { getTableHeaders } from "../table-commands";
import { cellLabel } from "../table-sizing";
import { blockColorClass } from "./NotionFidelity";

export const tablePresentationKey = new PluginKey<DecorationSet>(
  "contentTablePresentation",
);

function decorateTable(
  table: ProseMirrorNode,
  tablePos: number,
  decorations: Decoration[],
) {
  const headers = getTableHeaders(table);
  const columns: Array<{ color?: string } | null> = Array.isArray(
    table.attrs.colMeta,
  )
    ? table.attrs.colMeta
    : [];
  const map = TableMap.get(table);
  const tableStart = tablePos + 1;
  // A table shown as cards labels each value with its column's header.
  const labels: string[] = [];
  if (headers.row) {
    table.firstChild?.forEach((cell, cellOffset) => {
      labels[map.colCount(1 + cellOffset)] = cellLabel(cell.textContent);
    });
  }

  table.forEach((row, rowOffset, rowIndex) => {
    row.forEach((cell, cellOffset) => {
      const cellStart = rowOffset + 1 + cellOffset;
      const attrs: Record<string, string> = {};
      const label = rowIndex > 0 ? labels[map.colCount(cellStart)] : "";
      if (label) attrs["data-label"] = label;
      if (isEmptyCell(cell)) attrs["data-empty"] = "";
      if (cell.type.name === "tableHeader") {
        attrs.scope = headers.row && rowIndex === 0 ? "col" : "row";
      }
      // A cell's own colour, then its row's, cover its column's.
      const columnColor = columns[map.colCount(cellStart)]?.color;
      if (
        !cell.attrs.color &&
        !row.attrs.color &&
        columnColor &&
        columnColor !== "default" &&
        NFM_COLORS.has(columnColor)
      ) {
        attrs.class = blockColorClass(columnColor);
      }
      if (Object.keys(attrs).length) {
        const from = tableStart + cellStart;
        decorations.push(Decoration.node(from, from + cell.nodeSize, attrs));
      }
    });
  });
}

function isEmptyCell(cell: ProseMirrorNode) {
  const only = cell.childCount === 1 ? cell.firstChild : null;
  return !!only?.isTextblock && only.content.size === 0;
}

function buildDecorations(doc: ProseMirrorNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") decorateTable(node, pos, decorations);
    return !node.isTextblock && !node.isAtom;
  });
  return decorations.length
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

/**
 * What a table's structure means for its cells but no cell stores: header
 * cells' `scope`, the column colours in the table's `colMeta`, and, for
 * tables shown as cards, each value's header and which cells are empty.
 */
export const TablePresentation = Extension.create({
  name: "contentTablePresentation",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tablePresentationKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, decorations) =>
            tr.docChanged ? buildDecorations(tr.doc) : decorations,
        },
        props: {
          decorations: (state) => tablePresentationKey.getState(state),
        },
      }),
    ];
  },
});

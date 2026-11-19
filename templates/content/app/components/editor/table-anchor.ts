import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { type Item, XmlElement, type XmlFragment } from "yjs";

import type { TableAt } from "./table-commands";

interface LiveCopy {
  type: XmlFragment;
  mapping: Map<unknown, unknown>;
}

function liveCopy(state: EditorState) {
  const binding = ySyncPluginKey.getState(state)?.binding as
    | LiveCopy
    | null
    | undefined;
  return binding ?? null;
}

export interface TableAnchor {
  doc: ProseMirrorNode;
  pos: number;
  live: { table: XmlElement; parts: unknown[]; spans: string } | null;
}

interface LivePart {
  _item: Item | null;
  readonly parent: LivePart | null;
}

function isInPage(type: LivePart, page: XmlFragment) {
  let current: LivePart | null = type;
  while (current && current !== page) {
    if (!current._item || current._item.deleted) return false;
    current = current.parent;
  }
  return current === page;
}

function tableParts(table: XmlElement) {
  return table
    .toArray()
    .flatMap((row) =>
      row instanceof XmlElement ? [row, ...row.toArray()] : [row],
    );
}

function cellSpans(table: ProseMirrorNode) {
  const spans: unknown[] = [];
  table.forEach((row) =>
    row.forEach((cell) => spans.push(cell.attrs.rowspan, cell.attrs.colspan)),
  );
  return spans.join(" ");
}

export function anchorTable(state: EditorState, table: TableAt): TableAnchor {
  const copy = liveCopy(state);
  let live: TableAnchor["live"] = null;
  for (const [type, node] of copy?.mapping ?? []) {
    if (node !== table.node || !(type instanceof XmlElement)) continue;
    if (!copy || !isInPage(type, copy.type)) continue;
    live = {
      table: type,
      parts: tableParts(type),
      spans: cellSpans(table.node),
    };
    break;
  }
  return { doc: state.doc, pos: table.pos, live };
}

export function findAnchoredTable(
  state: EditorState,
  anchor: TableAnchor,
): TableAt | null {
  if (state.doc === anchor.doc) {
    const node = state.doc.nodeAt(anchor.pos);
    return node ? { node, pos: anchor.pos } : null;
  }
  const copy = liveCopy(state);
  const live = anchor.live;
  if (!copy || !live || !isInPage(live.table, copy.type)) return null;
  const parts = tableParts(live.table);
  const unchanged =
    parts.length === live.parts.length &&
    parts.every((part, index) => part === live.parts[index]);
  if (!unchanged) return null;

  const node = copy.mapping.get(live.table);
  let result: TableAt | null = null;
  state.doc.descendants((child, pos) => {
    if (result) return false;
    if (child === node) {
      if (cellSpans(child) === live.spans) result = { node: child, pos };
      return false;
    }
    return !child.isTextblock;
  });
  return result;
}
